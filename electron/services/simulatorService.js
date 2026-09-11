/**
 * 数据模拟服务（Service Layer）
 *
 * 职责：把「生成一套具备统计特征、且勾稽自洽的供应链数据」这件事编排完整。
 * 完整流水：
 *     创建运行记录 → 清理历史数据 → 生成主数据并落库 → 查回真实 id
 *       → 逐日推演 → 写订单与明细 → 写流水与快照 → 回填 ABC → 勾稽自检 → 更新运行记录
 *
 * 为什么生成要放后台跑、而不是等它返回：
 *     一次生成要写 5 万条量级的数据，若在 IPC handler 里 await 到结束，
 *     渲染层会一直等不到响应。因此这里 startGenerate 立即返回，
 *     真正的生成在后台异步执行；前端通过 sim-status 轮询查看阶段与进度。
 *
 * 进度放在进程内变量而非数据库：它是瞬时的界面状态，没必要落库；
 * 页面刷新后拿不到进度也无妨，因为轮询会重新取到最新值。
 *
 * 分层约定：本层只调 Repository 与同层的 sim 模块，不直接写 SQL。
 */
const { createRandom, createNormal } = require('./sim/prng')
const { generateMasterData } = require('./sim/masterData')
const { runSimulation } = require('./sim/engine')
const { runSelfCheck, computeFingerprint } = require('./sim/selfCheck')

const supplierRepository = require('../db/repositories/supplierRepository')
const materialRepository = require('../db/repositories/materialRepository')
const purchaseOrderRepository = require('../db/repositories/purchaseOrderRepository')
const inventoryRepository = require('../db/repositories/inventoryRepository')
const simRunRepository = require('../db/repositories/simRunRepository')
const { clearTables } = require('../db/repositories/batchInserter')

/** 默认生成参数（60 物料 × 12 供应商 × 24 个月，约 5 万条数据） */
const DEFAULTS = {
  seed: 20260911,
  materialCount: 60,
  supplierCount: 12,
  months: 24
}

/**
 * 重新生成前需要清空的业务表。
 * 注意两点：
 *   - alert_rule 不清（规则是配置，不是生成的数据）；
 *   - sim_run 不清（生成历史要保留，否则无法比对「同种子指纹」）。
 * 清空顺序按依赖倒序，先明细后主表。
 */
const TABLES_TO_CLEAR = [
  'inventory_flow',
  'inventory_snapshot',
  'purchase_order_item',
  'purchase_order',
  'material',
  'supplier',
  'alert_record'
]

/** 进程内的生成进度状态（供前端轮询） */
const progressState = {
  running: false,
  phase: '',
  percent: 0,
  startedAt: null,
  lastResult: null,
  lastError: null
}

/** 更新进度状态 */
function setProgress(phase, percent) {
  progressState.phase = phase
  progressState.percent = Math.min(100, Math.max(0, Math.round(percent)))
}

/**
 * 归一化并校验入参，防止前端传入越界值把主进程拖垮。
 * @param {Object} payload 原始入参
 * @returns {{ ok: boolean, message?: string, options?: Object }}
 */
function normalizeOptions(payload = {}) {
  const seed = Number.isFinite(Number(payload.seed)) ? Math.floor(Number(payload.seed)) : DEFAULTS.seed
  const materialCount = Number.isFinite(Number(payload.materialCount)) ? Math.floor(Number(payload.materialCount)) : DEFAULTS.materialCount
  const supplierCount = Number.isFinite(Number(payload.supplierCount)) ? Math.floor(Number(payload.supplierCount)) : DEFAULTS.supplierCount
  const months = Number.isFinite(Number(payload.months)) ? Math.floor(Number(payload.months)) : DEFAULTS.months

  if (seed < 0 || seed > 2147483647) {
    return { ok: false, message: '随机种子需在 0 ~ 2147483647 之间' }
  }
  if (materialCount < 1 || materialCount > 300) {
    return { ok: false, message: '物料数量需在 1 ~ 300 之间' }
  }
  if (supplierCount < 1 || supplierCount > 60) {
    return { ok: false, message: '供应商数量需在 1 ~ 60 之间' }
  }
  if (months < 1 || months > 60) {
    return { ok: false, message: '模拟月数需在 1 ~ 60 之间' }
  }
  return { ok: true, options: { seed, materialCount, supplierCount, months } }
}

/**
 * 按「年消耗金额」做 ABC 分类（帕累托 80 / 15 / 5）。
 * ABC 必须等推演出流水、拿到消耗金额之后才能算，
 * 所以它是生成流程的最后一步，而不是建物料时就拍定。
 * @param {Object[]} flows 出入库流水
 * @param {Object[]} materials 物料（含数据库 id）
 * @param {string} cutoffDate 统计起点（YYYY-MM-DD），只统计该日之后的出库金额
 * @returns {Array<{ code: string, abcClass: string }>}
 */
function computeAbcClasses(flows, materials, cutoffDate) {
  const amountByMaterial = new Map()
  for (const f of flows) {
    if (f.flow_type !== 'out') continue
    if (cutoffDate && f.flow_date < cutoffDate) continue
    amountByMaterial.set(f.material_id, (amountByMaterial.get(f.material_id) || 0) + f.amount)
  }
  // 按消耗金额降序，累计占比达 80% 为 A、95% 为 B、其余为 C
  const sorted = [...amountByMaterial.entries()].sort((a, b) => b[1] - a[1])
  const total = sorted.reduce((sum, [, amount]) => sum + amount, 0)
  const classById = new Map()
  let cumulative = 0
  for (const [materialId, amount] of sorted) {
    cumulative += amount
    const ratio = total > 0 ? cumulative / total : 1
    classById.set(materialId, ratio <= 0.8 ? 'A' : ratio <= 0.95 ? 'B' : 'C')
  }
  // 期间内没有任何消耗的物料归入 C 类
  return materials.map((m) => ({ code: m.code, abcClass: classById.get(m.id) || 'C' }))
}

/**
 * 执行一次完整的生成流水（内部函数，由 startGenerate 在后台调用）。
 * @param {{ seed: number, materialCount: number, supplierCount: number, months: number }} options
 * @returns {Promise<Object>} 生成结果摘要
 */
async function generate(options) {
  const { seed, materialCount, supplierCount, months } = options
  const startedAt = Date.now()

  // 推演终点取今天零点，起点取 months 个月前的 1 号
  const endDate = new Date()
  endDate.setHours(0, 0, 0, 0)
  const startDate = new Date(endDate.getTime())
  startDate.setMonth(startDate.getMonth() - months)
  startDate.setDate(1)

  const startStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`
  const endStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`

  setProgress('创建运行记录', 2)
  const runNo = `RUN${Date.now()}`
  const runId = await simRunRepository.createRun({
    run_no: runNo,
    seed,
    material_count: materialCount,
    supplier_count: supplierCount,
    start_date: startStr,
    end_date: endStr,
    profile: null
  })

  try {
    // ===== 清空历史数据 =====
    setProgress('清理历史数据', 5)
    await clearTables(TABLES_TO_CLEAR)

    // ===== 生成主数据 =====
    // 主数据与推演使用两个独立的随机源（种子分别为 seed 与 seed + 1），
    // 避免两段逻辑互相消耗随机数；只要 seed 相同，两段序列都完全可复现。
    setProgress('生成主数据', 10)
    const masterRandom = createRandom(seed)
    const masterNormal = createNormal(masterRandom)
    const masterData = generateMasterData({
      random: masterRandom,
      normal: masterNormal,
      materialCount,
      supplierCount
    })

    // ===== 主数据落库并查回真实 id =====
    setProgress('写入供应商与物料', 15)
    await supplierRepository.batchCreate(masterData.suppliers)
    await materialRepository.batchCreate(masterData.materials)

    const savedSuppliers = await supplierRepository.listAll()
    const savedMaterials = await materialRepository.listAll()
    // 把「仅参与推演的模拟参数」合并回带 id 的对象上（两个来源字段不重名，不会互相覆盖）
    const supplierParamMap = new Map(masterData.suppliers.map((s) => [s.code, s]))
    const materialParamMap = new Map(masterData.materials.map((m) => [m.code, m]))
    const suppliersWithId = savedSuppliers.map((s) => ({ ...s, ...supplierParamMap.get(s.code) }))
    const materialsWithId = savedMaterials.map((m) => ({ ...m, ...materialParamMap.get(m.code) }))

    // ===== 逐日推演 =====
    setProgress('逐日推演库存与订单', 25)
    const simRandom = createRandom(seed + 1)
    const simNormal = createNormal(simRandom)
    const simulation = runSimulation({
      random: simRandom,
      normal: simNormal,
      suppliers: suppliersWithId,
      materials: materialsWithId,
      startDate,
      endDate
    })
    const { orders, items, flows, snapshots, stats } = simulation

    // ===== 写采购订单与明细 =====
    setProgress('写入采购订单', 45)
    await purchaseOrderRepository.batchCreateOrders(orders)
    // 明细要带 order_id：批量插入拿不到自增主键，故用订单号换 id
    const orderIdMap = await purchaseOrderRepository.mapIdsByOrderNo(orders.map((o) => o.order_no))
    const itemRows = items.map((it) => ({
      order_id: orderIdMap.get(it.order_no),
      material_id: it.material_id,
      qty: it.qty,
      unit_price: it.unit_price,
      amount: it.amount,
      received_qty: it.received_qty,
      qualified_qty: it.qualified_qty,
      defect_qty: it.defect_qty
    }))
    await purchaseOrderRepository.batchCreateItems(itemRows)

    // ===== 写流水与快照（流水是全表里体量最大的一张，进度按条数插值） =====
    await inventoryRepository.batchCreateFlows(flows, (written, total) => {
      setProgress('写入出入库流水', 55 + (written / Math.max(1, total)) * 30)
    })
    setProgress('写入月度库存快照', 90)
    await inventoryRepository.batchCreateSnapshots(snapshots)

    // ===== 回填 ABC 分类 =====
    setProgress('回填 ABC 分类', 94)
    const cutoff = new Date(endDate.getTime())
    cutoff.setDate(cutoff.getDate() - 365)
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`
    await materialRepository.updateAbcClasses(computeAbcClasses(flows, materialsWithId, cutoffStr))

    // ===== 勾稽自检 =====
    setProgress('执行勾稽自检', 97)
    const fingerprint = computeFingerprint({
      seed,
      materialCount,
      supplierCount,
      startDate: startStr,
      endDate: endStr,
      stats
    })
    const previousRun = await simRunRepository.findLatestBySeed(seed, runNo)
    const selfcheck = await runSelfCheck({ seed, fingerprint, previousRun })

    const rowCounts = {
      supplier: masterData.suppliers.length,
      material: masterData.materials.length,
      purchase_order: orders.length,
      purchase_order_item: items.length,
      inventory_flow: flows.length,
      inventory_snapshot: snapshots.length
    }

    const durationMs = Date.now() - startedAt
    setProgress('完成', 100)
    await simRunRepository.updateRun(runId, {
      status: 'success',
      profile: masterData.profile,
      selfcheck,
      row_counts: rowCounts,
      message: `用时 ${(durationMs / 1000).toFixed(1)} 秒`,
      finished_at: new Date()
    })

    return {
      runNo,
      seed,
      materialCount,
      supplierCount,
      startDate: startStr,
      endDate: endStr,
      stats,
      rowCounts,
      selfcheck,
      profile: masterData.profile,
      durationMs
    }
  } catch (err) {
    // 失败也要落一条记录，便于在生成历史里看到失败原因
    const message = err && err.message ? err.message : '生成失败'
    await simRunRepository
      .updateRun(runId, { status: 'failed', message, finished_at: new Date() })
      .catch(() => {})
    throw err
  }
}

/**
 * 启动一次生成（立即返回，生成在后台进行）。
 * @param {Object} payload 含 seed / materialCount / supplierCount / months
 * @returns {{ success: boolean, message: string }}
 */
function startGenerate(payload = {}) {
  if (progressState.running) {
    return { success: false, message: '上一次生成尚未结束，请稍候' }
  }
  const normalized = normalizeOptions(payload)
  if (!normalized.ok) {
    return { success: false, message: normalized.message }
  }

  progressState.running = true
  progressState.phase = '准备中'
  progressState.percent = 0
  progressState.startedAt = Date.now()
  progressState.lastResult = null
  progressState.lastError = null

  // 刻意不 await：立即把控制权交回渲染层，前端靠轮询拿进度
  generate(normalized.options)
    .then((result) => {
      progressState.lastResult = result
    })
    .catch((err) => {
      console.error('[simulatorService.startGenerate] 生成失败:', err)
      progressState.lastError = err && err.message ? err.message : '生成失败'
    })
    .finally(() => {
      progressState.running = false
    })

  return { success: true, message: '已开始生成' }
}

/**
 * 读取当前生成状态（前端轮询用）。
 * @returns {Object} 含 running / phase / percent / lastResult / lastError
 */
function getStatus() {
  return {
    running: progressState.running,
    phase: progressState.phase,
    percent: progressState.percent,
    startedAt: progressState.startedAt,
    lastResult: progressState.lastResult,
    lastError: progressState.lastError
  }
}

/**
 * 生成历史（供页面展示「之前生成过几次、结果如何」）。
 * @param {number} [limit] 最多返回条数
 * @returns {Promise<{ success: boolean, runs?: Object[], message?: string }>}
 */
async function listHistory(limit = 10) {
  try {
    const runs = await simRunRepository.listRuns(limit)
    return { success: true, runs }
  } catch (err) {
    console.error('[simulatorService.listHistory] 数据库异常:', err)
    return { success: false, message: err && err.message ? err.message : '读取生成历史失败' }
  }
}

module.exports = {
  startGenerate,
  getStatus,
  listHistory,
  DEFAULTS
}
