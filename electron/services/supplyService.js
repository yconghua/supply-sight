/**
 * 供应链数据服务（Service Layer）—— 阶段 0 最小版
 *
 * 当前职责：把「数据结构是否就位」这件事变成一次可调用的查询，供上层页面验证。
 *   - getOverview()：9 张业务表的存在性与行数，缺表会明确标出来；
 *   - getLatestRun()：最近一次数据生成的情况。
 *
 * 分层约定：本层只调 Repository，绝不直接写 SQL、也不直接碰数据库连接。
 * 后续阶段的模拟器、指标计算、规则引擎会各自独立成 simulatorService / metricService / alertService，
 * 避免这个文件膨胀成什么都往里塞的杂物间。
 */
const supplierRepository = require('../db/repositories/supplierRepository')
const materialRepository = require('../db/repositories/materialRepository')
const purchaseOrderRepository = require('../db/repositories/purchaseOrderRepository')
const inventoryRepository = require('../db/repositories/inventoryRepository')
const alertRepository = require('../db/repositories/alertRepository')
const simRunRepository = require('../db/repositories/simRunRepository')

/**
 * 业务表清单（表名 / 中文名 / 计数方法）。
 * 顺序按数据产生的先后排列，便于在页面上按流程顺序展示：
 * 主数据 → 订单 → 流水 → 快照 → 规则 → 预警 → 生成记录。
 */
const TABLE_DEFS = [
  { name: 'supplier', label: '供应商', count: () => supplierRepository.count() },
  { name: 'material', label: '物料', count: () => materialRepository.count() },
  { name: 'purchase_order', label: '采购订单', count: () => purchaseOrderRepository.count() },
  { name: 'purchase_order_item', label: '订单明细', count: () => purchaseOrderRepository.countItems() },
  { name: 'inventory_flow', label: '出入库流水', count: () => inventoryRepository.countFlows() },
  { name: 'inventory_snapshot', label: '月度库存快照', count: () => inventoryRepository.countSnapshots() },
  { name: 'alert_rule', label: '预警规则', count: () => alertRepository.countRules() },
  { name: 'alert_record', label: '预警记录', count: () => alertRepository.countRecords() },
  { name: 'sim_run', label: '模拟运行记录', count: () => simRunRepository.count() }
]

/**
 * 业务总览：逐张表统计存在性与行数。
 * 表不存在（ER_NO_SUCH_TABLE）视为「尚未初始化」而非错误——用户添加数据库后
 * schemas 会自动建表，此处如实标记缺失即可，其余异常才向上抛出。
 * @returns {Promise<{success: boolean, tables?: Object[], missing?: string[], totalRows?: number, ready?: boolean, message?: string}>}
 */
async function getOverview() {
  try {
    const tables = []
    // 串行统计：并行会同时占用多个连接（连接池上限 10），串行更稳且总耗时仍在百毫秒级
    for (const def of TABLE_DEFS) {
      try {
        const count = await def.count()
        tables.push({ name: def.name, label: def.label, exists: true, count })
      } catch (err) {
        if (err && err.code === 'ER_NO_SUCH_TABLE') {
          tables.push({ name: def.name, label: def.label, exists: false, count: 0 })
        } else {
          throw err
        }
      }
    }
    const missing = tables.filter((t) => !t.exists).map((t) => t.name)
    const totalRows = tables.reduce((sum, t) => sum + t.count, 0)
    return {
      success: true,
      tables,
      missing,
      totalRows,
      // ready 为 true 表示 9 张表都已建好，可以进入数据生成阶段
      ready: missing.length === 0
    }
  } catch (err) {
    console.error('[supplyService.getOverview] 数据库异常:', err)
    return {
      success: false,
      message: err && err.message ? err.message : '读取数据总览失败，请检查数据库连接'
    }
  }
}

/**
 * 最近一次数据生成记录（种子 / 规模 / 埋点 / 自检结果）
 * @returns {Promise<{success: boolean, run?: Object|null, message?: string}>}
 */
async function getLatestRun() {
  try {
    const run = await simRunRepository.findLatest()
    return { success: true, run }
  } catch (err) {
    console.error('[supplyService.getLatestRun] 数据库异常:', err)
    return {
      success: false,
      message: err && err.message ? err.message : '读取生成记录失败'
    }
  }
}

module.exports = {
  getOverview,
  getLatestRun,
  TABLE_DEFS
}
