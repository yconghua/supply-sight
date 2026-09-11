/**
 * 指标计算服务（Service Layer）
 *
 * 三个业务问题的答案都从这个文件算出来：
 *   - 哪家供应商不靠谱  → getSupplierMetrics（OTD / PPM / 平均延迟 / 综合评分）
 *   - 库存压了多少钱    → getInventoryMetrics（期末金额 / 周转天数 / 呆滞 / ABC）
 *   - 成本为何降不下来  → getCostMetrics（加权均价 / 价格指数 / 涨幅 / 月度序列）
 *
 * 设计原则：指标只在这里算一次，页面与规则引擎都来取。
 * 规则引擎因此只需要「比较」，不需要知道 OTD 或周转天数是怎么来的——
 * 这正是「加一条规则 = 改一行 JSON，不动代码」的前提。
 *
 * 口径说明（对外可以直接讲）：
 *   OTD 准时交付率 = 准时到货订单数 ÷ 已到货订单数（未到货不参与分母）
 *   PPM 百万不良率 = 不良数量 ÷ 到货数量 × 1,000,000
 *   周转天数       = 期间天数 ÷ (期间出库金额 ÷ 平均库存金额)
 *   价格指数       = 本期加权均价 ÷ 基期加权均价
 *
 * 分层约定：本层只调 Repository，不写 SQL。
 */
const supplierRepository = require('../db/repositories/supplierRepository')
const materialRepository = require('../db/repositories/materialRepository')
const inventoryRepository = require('../db/repositories/inventoryRepository')
const purchaseOrderRepository = require('../db/repositories/purchaseOrderRepository')

/** 呆滞判定阈值：周转天数超过 180 天，且连续 60 天没有出库 */
const DEAD_TURNOVER_DAYS = 180
const DEAD_IDLE_DAYS = 60

/** 默认周转率统计窗口（月） */
const DEFAULT_TURNOVER_WINDOW = 12

/** 安全取数：把 MySQL 返回的字符串 / null 统一转成数字，取不到时返回 fallback */
function num(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * 供应商绩效指标。
 * @param {{ months?: number }} [options] months 传值时只统计最近 N 个月
 * @returns {Promise<Array>} 每家供应商一行，含 otdRate / ppm / score 等
 */
async function getSupplierMetrics(options = {}) {
  const rows = await supplierRepository.getPerformanceMetrics(options)
  return rows.map((r) => {
    const receivedCount = num(r.received_count)
    const onTimeCount = num(r.on_time_count)
    const receivedQty = num(r.received_qty)
    const defectQty = num(r.defect_qty)

    // 没有到货记录时，OTD / PPM 无从谈起，返回 null 让页面显示「—」而不是误导性的 0
    const otdRate = receivedCount > 0 ? onTimeCount / receivedCount : null
    const ppm = receivedQty > 0 ? (defectQty / receivedQty) * 1000000 : null

    // 综合评分：交付准时占 60%，来料质量占 40%。
    // 质量得分按 PPM 折算，10000 PPM（1% 不良）即得 0 分——这是一个可解释的线性折算，
    // 不用复杂的加权公式，讲得清楚比算得花哨重要。
    const qualityScore = ppm === null ? 0 : Math.max(0, 1 - Math.min(ppm / 10000, 1))
    const score = otdRate === null ? null : Math.round((otdRate * 0.6 + qualityScore * 0.4) * 100)

    return {
      id: r.id,
      code: r.code,
      name: r.name,
      category: r.category,
      creditLevel: r.credit_level,
      paymentDays: num(r.payment_days),
      orderCount: num(r.order_count),
      receivedCount,
      onTimeCount,
      otdRate,
      ppm,
      receivedQty,
      defectQty,
      totalAmount: num(r.total_amount),
      avgDelayDays: num(r.avg_delay_days),
      score
    }
  })
}

/**
 * 库存健康度指标。
 * @param {{ months?: number }} [options] months 周转率的统计窗口，默认最近 12 个月
 * @returns {Promise<{ items: Array, summary: Object }>}
 */
async function getInventoryMetrics(options = {}) {
  const windowMonths = options.months > 0 ? options.months : DEFAULT_TURNOVER_WINDOW

  // 四个查询互不依赖，并行取回后在内存里按 material_id 拼装
  const [latest, outbound, lastOutbound, averages] = await Promise.all([
    inventoryRepository.getLatestSnapshots(),
    inventoryRepository.getOutboundSummary({ months: windowMonths }),
    inventoryRepository.getLastOutboundDates(),
    inventoryRepository.getAverageSnapshotByMaterial()
  ])

  const outMap = new Map(outbound.map((r) => [String(r.material_id), r]))
  const lastMap = new Map(lastOutbound.map((r) => [String(r.material_id), r.last_out_date]))
  const avgMap = new Map(averages.map((r) => [String(r.material_id), r]))

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const items = latest.map((sn) => {
    const key = String(sn.material_id)
    const out = outMap.get(key) || { out_qty: 0, out_amount: 0 }
    const avg = avgMap.get(key) || { avg_amount: 0, avg_qty: 0, period_count: 0 }
    const lastOutDate = lastMap.get(key) || null

    const endQty = num(sn.end_qty)
    const amount = num(sn.amount)
    const unitPrice = num(sn.unit_price)
    const outAmount = num(out.out_amount)
    const avgAmount = num(avg.avg_amount)
    const periodCount = num(avg.period_count)
    // 每期按 30 天折算，得到周转率的统计天数
    const periodDays = periodCount * 30

    // 周转率 = 期间出库金额 ÷ 平均库存金额；分母为 0（从未有库存）时置 null
    const turnoverRate = avgAmount > 0 ? outAmount / avgAmount : null
    const turnoverDays = turnoverRate && turnoverRate > 0 ? periodDays / turnoverRate : null

    // 呆滞天数：最后一次出库距今多少天。从未出库过的按统计期长计（保守取 9999 表示「极久」）
    let idleDays = null
    if (lastOutDate) {
      idleDays = Math.round((today.getTime() - new Date(lastOutDate).getTime()) / 86400000)
      if (idleDays < 0) idleDays = 0
    }

    // 呆滞判定：周转天数超标「且」长期无出库——两个条件缺一不可。
    // 只看周转慢会把「正常慢销但仍在领用」的物料误杀，加上无出库这一条才站得住。
    const isDead = turnoverDays !== null && turnoverDays > DEAD_TURNOVER_DAYS &&
      idleDays !== null && idleDays > DEAD_IDLE_DAYS

    return {
      materialId: sn.material_id,
      code: sn.code,
      name: sn.name,
      category: sn.category,
      unit: sn.unit,
      abcClass: sn.abc_class,
      period: sn.period,
      beginQty: num(sn.begin_qty),
      inQty: num(sn.in_qty),
      outQty: num(sn.out_qty),
      endQty,
      unitPrice,
      amount,
      reorderPoint: num(sn.reorder_point),
      moq: num(sn.moq),
      outAmount,
      avgAmount,
      turnoverRate,
      turnoverDays,
      lastOutDate,
      idleDays,
      isDead,
      // 库存是否低于订货点（补货提醒的直观依据）
      belowReorder: endQty <= num(sn.reorder_point)
    }
  })

  // 汇总口径：库存总额、呆滞金额与占比、ABC 金额分布、低于订货点的物料数
  const totalAmount = items.reduce((sum, it) => sum + it.amount, 0)
  const deadItems = items.filter((it) => it.isDead)
  const deadAmount = deadItems.reduce((sum, it) => sum + it.amount, 0)
  const abcAmount = { A: 0, B: 0, C: 0 }
  const abcCount = { A: 0, B: 0, C: 0 }
  for (const it of items) {
    const cls = it.abcClass || 'C'
    if (abcAmount[cls] === undefined) {
      abcAmount[cls] = 0
      abcCount[cls] = 0
    }
    abcAmount[cls] += it.amount
    abcCount[cls] += 1
  }
  // 加权平均周转天数：只对有周转数据的物料求平均
  const withTurnover = items.filter((it) => it.turnoverDays !== null)
  const avgTurnoverDays = withTurnover.length
    ? withTurnover.reduce((sum, it) => sum + it.turnoverDays, 0) / withTurnover.length
    : null

  return {
    items,
    summary: {
      session: items.length,
      period: items.length ? items[0].period : '',
      totalAmount,
      deadCount: deadItems.length,
      deadAmount,
      deadRatio: totalAmount > 0 ? deadAmount / totalAmount : 0,
      abcAmount,
      abcCount,
      avgTurnoverDays,
      belowReorderCount: items.filter((it) => it.belowReorder).length,
      windowMonths
    }
  }
}

/**
 * 采购成本指标。
 * @param {{ months?: number }} [options] months 传值时只统计最近 N 个月
 * @returns {Promise<{ items: Array, summary: Object }>}
 */
async function getCostMetrics(options = {}) {
  const [summary, series, materials] = await Promise.all([
    purchaseOrderRepository.getCostSummaryByMaterial(options),
    purchaseOrderRepository.getMonthlyPriceSeries(options),
    materialRepository.listAll()
  ])

  const matMap = new Map(materials.map((m) => [String(m.id), m]))

  // 把「物料 × 月份」的扁平序列按物料分组，供趋势图与趋势型规则使用
  const seriesMap = new Map()
  for (const row of series) {
    const key = String(row.material_id)
    if (!seriesMap.has(key)) seriesMap.set(key, [])
    seriesMap.get(key).push({
      period: row.period,
      qty: num(row.qty),
      amount: num(row.amount),
      avgPrice: num(row.avg_price)
    })
  }

  const items = summary.map((r) => {
    const key = String(r.material_id)
    const m = matMap.get(key) || {}
    const points = seriesMap.get(key) || []
    // 基期取序列的第一个月，本期取最后一个月——首末对比最能反映累计涨幅
    const basePrice = points.length ? points[0].avgPrice : 0
    const currentPrice = points.length ? points[points.length - 1].avgPrice : 0
    const priceIndex = basePrice > 0 ? currentPrice / basePrice : null
    const changePct = priceIndex === null ? null : priceIndex - 1

    return {
      materialId: r.material_id,
      code: m.code || '',
      name: m.name || '',
      category: m.category || '',
      abcClass: m.abc_class || 'C',
      unit: m.unit || '',
      orderCount: num(r.order_count),
      totalQty: num(r.total_qty),
      totalAmount: num(r.total_amount),
      avgPrice: num(r.avg_price),
      basePrice,
      currentPrice,
      priceIndex,
      changePct,
      firstOrderDate: r.first_order_date,
      lastOrderDate: r.last_order_date,
      series: points
    }
  })

  const totalAmount = items.reduce((sum, it) => sum + it.totalAmount, 0)
  // 涨幅榜只保留有价格指数的物料（至少要跨两个有采购的月份才有意义）
  const withIndex = items.filter((it) => it.priceIndex !== null)
  const rising = withIndex.filter((it) => it.changePct > 0.05)
  const avgIndex = withIndex.length
    ? withIndex.reduce((sum, it) => sum + it.priceIndex, 0) / withIndex.length
    : null

  return {
    items,
    summary: {
      materialCount: items.length,
      totalAmount,
      avgPriceIndex: avgIndex,
      risingCount: rising.length,
      // 涨幅最高的前 5 个物料，页面直接用
      topRisers: [...rising].sort((a, b) => b.changePct - a.changePct).slice(0, 5)
    }
  }
}

/**
 * 首页概览：把三个模块的关键数字汇总成一张卡。
 * @returns {Promise<Object>}
 */
async function getOverview() {
  const [suppliers, inventory, cost] = await Promise.all([
    getSupplierMetrics(),
    getInventoryMetrics(),
    getCostMetrics()
  ])

  // 供应商端：按 OTD 升序，最差的排最前
  const risky = suppliers
    .filter((s) => s.otdRate !== null)
    .sort((a, b) => a.otdRate - b.otdRate)

  return {
    supplierCount: suppliers.length,
    riskySupplier: risky.length ? risky[0] : null,
    inventoryAmount: inventory.summary.totalAmount,
    deadAmount: inventory.summary.deadAmount,
    deadCount: inventory.summary.deadCount,
    avgTurnoverDays: inventory.summary.avgTurnoverDays,
    purchaseAmount: cost.summary.totalAmount,
    avgPriceIndex: cost.summary.avgPriceIndex,
    risingCount: cost.summary.risingCount
  }
}

module.exports = {
  getSupplierMetrics,
  getInventoryMetrics,
  getCostMetrics,
  getOverview,
  DEAD_TURNOVER_DAYS,
  DEAD_IDLE_DAYS
}
