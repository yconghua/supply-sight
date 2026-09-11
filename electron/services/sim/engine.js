/**
 * 逐日推演引擎（数据模拟器核心）
 *
 * 这是整个模拟器的中枢：所有业务数据都由「同一条时间轴上的推演」产生，
 * 而不是每张表各自造随机数。因果关系是单向且明确的：
 *
 *     库存跌破订货点 → 触发采购下单 → 供应商按正态分布延迟交货
 *       → 到货入库（扣掉不良品）→ 库存回升 → 生产领用持续消耗
 *
 * 因此三张表天然勾稽：
 *     - 采购订单是「因为库存低」才产生的；
 *     - 入库流水是「订单到货」产生的（ref_no 直接指向订单号）；
 *     - 月度快照是「流水汇总」出来的（期初 + 入 − 出 = 期末）。
 *
 * 库存金额用「移动加权平均」维护（永续盘存制）：
 *     入库时 qty += 合格数，value += 合格数 × 采购单价
 *     出库时按当前均价计价，value 同比减少
 * 这样「期末金额 = 期末数量 × 期末单价」由定义保证，不需要事后凑数。
 *
 * 三类统计特征的落点：
 *     - 需求：基值 × (1 + 正弦季节项) × (1 + 正态噪声) × 周末系数
 *     - 交付：实际到货日 = 承诺交期 + N(供应商延迟均值, 供应商延迟标准差)
 *     - 价格：本次单价 = 上次单价 × (1 + 漂移 + N(0, 波动率))
 */
const { randInt, randFloat, round2, round4, clamp } = require('./prng')

/** 把 Date 格式化为 YYYY-MM-DD */
function formatDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 把 Date 格式化为账期 YYYY-MM */
function formatPeriod(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** 在日期上加减天数，返回新 Date（不修改入参） */
function addDays(date, days) {
  const d = new Date(date.getTime())
  d.setDate(d.getDate() + days)
  return d
}

/** 判断是否为所在月的最后一天（月末要落一次库存快照） */
function isMonthEnd(date) {
  const next = addDays(date, 1)
  return next.getMonth() !== date.getMonth() || next.getFullYear() !== date.getFullYear()
}

/**
 * 执行一次完整推演。
 * @param {Object} options
 * @param {Function} options.random 均匀随机源（由种子决定）
 * @param {Function} options.normal 正态分布采样
 * @param {Object[]} options.suppliers 供应商（须已含数据库 id 与模拟参数）
 * @param {Object[]} options.materials 物料（须已含数据库 id 与模拟参数）
 * @param {Date} options.startDate 推演起始日
 * @param {Date} options.endDate 推演结束日（含）
 * @returns {{ orders: Object[], items: Object[], flows: Object[], snapshots: Object[], stats: Object }}
 */
function runSimulation({ random, normal, suppliers, materials, startDate, endDate }) {
  // 第一步：把数值字段规范化。
  // 这些对象有两个来源——内存生成（本来就是数字）与数据库读回
  // （mysql2 会把 DECIMAL 列返回成字符串，例如 '398.80'）。
  // 字符串一旦进入加法（如 reorder_point + 补货批量）就会退化成字符串拼接，
  // 既不报错、又能一路算出畸形结果，所以必须在推演之前转干净。
  const safeMaterials = materials.map(normalizeMaterial)
  const safeSuppliers = suppliers.map(normalizeSupplier)

  // 第二步：防御性校验。模拟参数一旦缺失，addDays 会算出 Invalid Date，
  // 字符串化后成为 'NaN-NaN-NaN'——它比任何合法日期字符串都"大"，
  // 表现为「订单永远在途、库存耗尽后不再补货」，而勾稽自检依然是平的，极难排查。
  // 因此在这里直接拦住，让错误在源头暴露。
  for (const m of safeMaterials) {
    if (
      !(Number(m.lead_time_days) > 0) ||
      !(Number(m.reorder_point) >= 0) ||
      !(Number(m.moq) > 0) ||
      !(Number(m.dailyDemand) >= 0)
    ) {
      throw new Error(
        '物料 ' + m.code + ' 缺少必要的模拟参数（lead_time_days / reorder_point / moq / dailyDemand）'
      )
    }
  }
  for (const s of safeSuppliers) {
    if (!Number.isFinite(Number(s.delayMean)) || !Number.isFinite(Number(s.delayStd))) {
      throw new Error('供应商 ' + s.code + ' 缺少必要的模拟参数（delayMean / delayStd）')
    }
  }

  const orders = []
  const items = []
  const flows = []
  const snapshots = []

  // 供应商编码 → 供应商对象，便于按物料的 primarySupplierCode 找到供货方
  const supplierByCode = new Map(safeSuppliers.map((s) => [s.code, s]))

  // 每个物料的运行时状态：库存数量 / 库存金额 / 当前采购价 / 在途订单 / 本月累计
  const runtimes = safeMaterials.map((m) => {
    // 开局给一笔期初库存（约半个月需求 + 一个订货点），避免开局长时间缺货失真
    const initialQty = Math.round(m.reorder_point + m.dailyDemand * 15)
    const initialValue = round2(initialQty * m.std_price)
    return {
      m,
      supplier: supplierByCode.get(m.primarySupplierCode) || safeSuppliers[0],
      qty: initialQty,
      value: initialValue,
      price: m.std_price, // 当前采购单价，随随机游走变化
      pending: [], // 在途订单
      demandPool: 0, // 需求累积池：小数需求攒够整数才产生一次出库
      monthBeginQty: initialQty, // 本月期初数量
      monthIn: 0, // 本月合格入库量
      monthOut: 0, // 本月出库量
      lastPrice: m.std_price // 上月期末单价（本月无库存时沿用）
    }
  })

  // 期初建账流水：让「开局的库存」也有来源可追溯，而不是凭空出现。
  // 该笔流水 ref_type 为 init，不参与「订单到货 = 入库」的核对。
  for (const rt of runtimes) {
    if (rt.qty > 0) {
      flows.push({
        flow_date: formatDate(addDays(startDate, -1)),
        material_id: rt.m.id,
        flow_type: 'in',
        qty: rt.qty,
        unit_price: round4(rt.m.std_price),
        amount: round2(rt.qty * rt.m.std_price),
        ref_type: 'init',
        ref_no: 'OPENING',
        supplier_id: null
      })
    }
  }

  let orderSeq = 0 // 订单流水号，保证订单号唯一
  let dayIndex = 0 // 距起始日的天数，用于计算季节相位
  const cursor = new Date(startDate.getTime())

  while (cursor.getTime() <= endDate.getTime()) {
    const dateStr = formatDate(cursor)
    const period = formatPeriod(cursor)
    // 周末按 0.3 倍折算领料量：车间周末多为值班而非满产，让流水有真实节奏
    const isWeekend = cursor.getDay() === 0 || cursor.getDay() === 6
    const weekendFactor = isWeekend ? 0.3 : 1

    for (const rt of runtimes) {
      const m = rt.m

      // ===== 第 1 步：生产领用出库 =====
      // 需求 = 基值 × 季节项 × 噪声 × 周末系数（正弦模拟季节性，正态模拟随机波动）
      const season = 1 + m.seasonAmp * Math.sin((2 * Math.PI * dayIndex) / 365 + m.seasonPhase)
      const noise = clamp(1 + normal(0, m.demandSigma), 0.2, 3)
      // 需求先累加进「需求池」再取整出库，而不是每天直接对需求取整。
      // 原因：低需求物料（如日均 0.01 件的停产备件）若每天取整会永远得到 0、彻底不出库，
      // 那样「呆滞库存」就成了一个算不出周转天数的死值。累加后攒够整数才领一次，
      // 既能真实还原「大约每 100 天领用一次」，也让「长期无出库」这个判断条件真正成立。
      rt.demandPool += (m.demandStopDay && dayIndex >= m.demandStopDay)
        ? 0 // 已过停产日：产品下线、备件不再领用，需求归零（这正是呆滞库存的起点）
        : m.dailyDemand * season * noise * weekendFactor
      const wantQty = Math.floor(rt.demandPool)
      // 需求池出清：缺料导致没领到的部分视为流失、不滚存，避免形成缺货雪球
      rt.demandPool -= wantQty
      // 出库量受现有库存限制：库存不足时只能领多少算多少，绝不做出负库存
      const outQty = Math.min(wantQty, rt.qty)
      if (outQty > 0) {
        // 出库按当前移动加权平均成本计价
        const avgPrice = rt.qty > 0 ? rt.value / rt.qty : rt.price
        const outAmount = round2(outQty * avgPrice)
        rt.qty = round2(rt.qty - outQty)
        rt.value = round2(rt.value - outAmount)
        if (rt.qty <= 0) {
          rt.qty = 0
          rt.value = 0
        }
        rt.monthOut = round2(rt.monthOut + outQty)
        flows.push({
          flow_date: dateStr,
          material_id: m.id,
          flow_type: 'out',
          qty: outQty,
          unit_price: round4(avgPrice),
          amount: outAmount,
          ref_type: 'produce',
          ref_no: `WO${dateStr.replace(/-/g, '')}`, // 当日生产领用单号
          supplier_id: null
        })
      }

      // ===== 第 2 步：在途订单到货入库 =====
      // 到货日已在下单时按供应商的延迟分布算定，这里只判断「是否已到」
      for (const po of rt.pending) {
        if (po.actualDate > dateStr) continue

        const receivedQty = po.item.qty
        // 不良率现场抽样：均值与波动都来自该供应商的固有水平
        const defectRate = clamp(normal(rt.supplier.defectRateMean, rt.supplier.defectRateStd), 0, 0.15)
        // 不良数 = 按比例抽样后「随机取整」（floor(x + U(0,1)) 的期望恰为 x）。
        // 这里不能用 Math.round：小批量下 0.5 件会进位成 1 件，把不良率系统性放大数倍，
        // 结果是正常供应商的 PPM 也被抬到阈值以上，预警直接误报。
        const defectQty = Math.min(receivedQty, Math.floor(receivedQty * defectRate + random()))
        const qualifiedQty = receivedQty - defectQty

        // 只有合格品入库，不良品不进库存——这也是「到货量 ≠ 入库量」的原因，
        // 因此勾稽自检核对的是「合格数量 = 入库数量」而不是「到货量 = 入库量」
        rt.qty = round2(rt.qty + qualifiedQty)
        rt.value = round2(rt.value + qualifiedQty * po.item.unit_price)
        rt.monthIn = round2(rt.monthIn + qualifiedQty)

        flows.push({
          flow_date: dateStr,
          material_id: m.id,
          flow_type: 'in',
          qty: qualifiedQty,
          unit_price: po.item.unit_price,
          amount: round2(qualifiedQty * po.item.unit_price),
          ref_type: 'purchase',
          ref_no: po.order.order_no,
          supplier_id: rt.supplier.id
        })

        // 回填订单与明细的到货结果
        po.order.actual_date = dateStr
        po.order.status = 'received'
        po.item.received_qty = receivedQty
        po.item.qualified_qty = qualifiedQty
        po.item.defect_qty = defectQty
      }
      // 已到货的订单移出在途列表
      rt.pending = rt.pending.filter((po) => po.actualDate > dateStr)

      // ===== 第 3 步：补货判断 =====
      // 采用 (s, S) 策略：无在途订单且库存跌到订货点以下时，补到目标库存并按 MOQ 取整
      if (rt.pending.length === 0 && rt.qty <= m.reorder_point) {
        const targetStock = m.reorder_point + Math.max(m.moq, m.dailyDemand * 30)
        let orderQty = Math.max(targetStock - rt.qty, m.moq)
        // 向上取整到 MOQ 的整数倍：这是慢动物料库存积压的直接机制
        orderQty = Math.round(Math.ceil(orderQty / m.moq) * m.moq)

        // 价格随机游走：在上次单价基础上叠加漂移与随机冲击，并限制在合理区间
        const shocked = rt.price * (1 + m.priceDrift + normal(0, m.priceVolatility))
        rt.price = round4(clamp(shocked, m.std_price * 0.5, m.std_price * 3))

        // 承诺交期 = 下单日 + 物料的标准采购提前期（字段来自 material 表的 lead_time_days）
        const promised = addDays(cursor, Number(m.lead_time_days))
        const delayDays = Math.round(normal(rt.supplier.delayMean, rt.supplier.delayStd))
        let actual = addDays(promised, delayDays)
        // 兜底：最快也要次日才能到货，避免出现「当天到货」的反常记录
        const minArrival = addDays(cursor, 1)
        if (actual.getTime() < minArrival.getTime()) actual = minArrival

        orderSeq += 1
        const orderNo = `PO${String(orderSeq).padStart(6, '0')}`
        const amount = round2(orderQty * rt.price)

        const order = {
          order_no: orderNo,
          supplier_id: rt.supplier.id,
          order_date: dateStr,
          promised_date: formatDate(promised),
          actual_date: null, // 到货时才回填
          total_amount: amount,
          status: 'pending'
        }
        const item = {
          order_no: orderNo,
          material_id: m.id,
          qty: orderQty,
          unit_price: rt.price,
          amount,
          received_qty: 0,
          qualified_qty: 0,
          defect_qty: 0
        }
        orders.push(order)
        items.push(item)
        rt.pending.push({
          order,
          item,
          actualDate: formatDate(actual) // 内部使用，不落库
        })
      }
    }

    // ===== 第 4 步：月末落库存快照 =====
    if (isMonthEnd(cursor)) {
      for (const rt of runtimes) {
        const endQty = rt.qty
        // 期末单价 = 期末金额 ÷ 期末数量；无库存时沿用上期单价，避免出现 0 单价
        const unitPrice = endQty > 0 ? round4(rt.value / endQty) : rt.lastPrice
        // 金额以单价为准反算，保证「金额 = 期末数量 × 期末单价」严格成立（取整误差内）
        const amount = endQty > 0 ? round2(endQty * unitPrice) : 0
        rt.value = amount

        snapshots.push({
          period,
          material_id: rt.m.id,
          begin_qty: rt.monthBeginQty,
          in_qty: rt.monthIn,
          out_qty: rt.monthOut,
          end_qty: endQty,
          unit_price: unitPrice,
          amount
        })

        // 进入下一账期：本期期末即下期期初，累计量清零
        rt.monthBeginQty = endQty
        rt.monthIn = 0
        rt.monthOut = 0
        rt.lastPrice = unitPrice
      }
    }

    dayIndex += 1
    cursor.setDate(cursor.getDate() + 1)
  }

  // 汇总统计，供页面展示（也在自检里作为数据指纹的组成部分）
  const stats = {
    orderCount: orders.length,
    itemCount: items.length,
    flowCount: flows.length,
    snapshotCount: snapshots.length,
    orderAmount: round2(orders.reduce((sum, o) => sum + o.total_amount, 0)),
    flowAmount: round2(flows.reduce((sum, f) => sum + f.amount, 0)),
    snapshotAmount: round2(snapshots.reduce((sum, s) => sum + s.amount, 0))
  }

  return { orders, items, flows, snapshots, stats }
}

/**
 * 尽量把字段值转成数字；缺失或转不出来时返回 undefined。
 * 刻意不做「转不了就置 0」的兜底：那会把「字段缺失」伪装成合法值，
 * 让下面的防御性校验形同虚设。转不出来的值交给校验去报错。
 */
function toNumber(value) {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/**
 * 转数字，转不出来时返回 0——用于「0 本身就是合法含义」的可选字段，
 * 例如 priceDrift = 0 表示不涨价、demandStopDay = 0 表示全期都有需求。
 */
function toNumberOrZero(value) {
  const n = toNumber(value)
  return n === undefined ? 0 : n
}

/**
 * 规范化物料对象的数值字段。
 * 主要目的：数据库读回时 DECIMAL / INT 会被 mysql2 以字符串形式返回（如 '398.80'），
 * 这里统一转成数字，避免后续加法退化成字符串拼接。
 */
function normalizeMaterial(m) {
  return {
    ...m,
    std_price: toNumberOrZero(m.std_price),
    reorder_point: toNumberOrZero(m.reorder_point),
    moq: toNumberOrZero(m.moq),
    lead_time_days: toNumberOrZero(m.lead_time_days),
    dailyDemand: toNumberOrZero(m.dailyDemand),
    demandSigma: toNumberOrZero(m.demandSigma),
    seasonAmp: toNumberOrZero(m.seasonAmp),
    seasonPhase: toNumberOrZero(m.seasonPhase),
    priceVolatility: toNumberOrZero(m.priceVolatility),
    priceDrift: toNumberOrZero(m.priceDrift),
    demandStopDay: toNumberOrZero(m.demandStopDay)
  }
}

/**
 * 规范化供应商对象的数值字段。
 * delayMean / delayStd 用严格模式：缺失时保持 undefined，从而被前面的校验拦下——
 * 它们是每个供应商的固有特性，不能拿 0（「平均准时」）当默认值蒙混过去。
 */
function normalizeSupplier(s) {
  return {
    ...s,
    delayMean: toNumber(s.delayMean),
    delayStd: toNumber(s.delayStd),
    defectRateMean: toNumberOrZero(s.defectRateMean),
    defectRateStd: toNumberOrZero(s.defectRateStd)
  }
}

module.exports = { runSimulation, formatDate, formatPeriod, addDays }
