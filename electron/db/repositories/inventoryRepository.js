/**
 * 库存仓库（Repository Layer）—— 对应 `inventory_flow` 与 `inventory_snapshot` 两张表
 *
 * 两张表同属库存这一聚合根：流水是数量变动的事实来源，快照是按账期汇总的结果。
 * 勾稽关系：快照的 end_qty = begin_qty + in_qty - out_qty，逐月串联。
 *
 * 数据量提醒：流水是全部表里最大的一张（60 物料 × 730 天量级），
 * 因此查询一律带 material_id / 日期条件走索引，避免全表扫描。
 *
 * 导出单例：全局共用同一个仓库实例。
 */
const BaseRepository = require('./BaseRepository')
const { buildWhereClause } = require('./queryHelpers')
const { batchInsert } = require('./batchInserter')

// 出入库流水批量写入的列顺序
const FLOW_COLUMNS = [
  'flow_date',
  'material_id',
  'flow_type',
  'qty',
  'unit_price',
  'amount',
  'ref_type',
  'ref_no',
  'supplier_id'
]

// 月度快照批量写入的列顺序
const SNAPSHOT_COLUMNS = [
  'period',
  'material_id',
  'begin_qty',
  'in_qty',
  'out_qty',
  'end_qty',
  'unit_price',
  'amount'
]

class InventoryRepository extends BaseRepository {
  constructor() {
    // 聚合根绑定到流水表（体量最大、查询最多的一张）
    super('inventory_flow')
  }

  // ---------- 出入库流水 ----------

  /**
   * 批量写入出入库流水（模拟器调用，写入量最大的一张表）
   * @param {Array<Object|Array>} rows 行数据
   * @param {Function} [onProgress] 进度回调 (written, total)
   * @returns {Promise<number>} 写入行数
   */
  async batchCreateFlows(rows, onProgress) {
    return batchInsert('inventory_flow', FLOW_COLUMNS, rows, { onProgress })
  }

  /**
   * 流水列表，支持按物料 / 日期区间 / 类型 / 来源单号过滤
   * @param {{ materialId?: number, dateFrom?: string, dateTo?: string, flowType?: string, refNo?: string }} filters
   * @returns {Object[]} 按日期倒序
   */
  async listFlows(filters = {}) {
    const conditions = []
    if (filters.materialId) {
      conditions.push({ field: 'material_id', op: '=', value: filters.materialId })
    }
    if (filters.dateFrom) {
      conditions.push({ field: 'flow_date', op: '>=', value: filters.dateFrom })
    }
    if (filters.dateTo) {
      conditions.push({ field: 'flow_date', op: '<=', value: filters.dateTo })
    }
    if (filters.flowType) {
      conditions.push({ field: 'flow_type', op: '=', value: filters.flowType })
    }
    if (filters.refNo) {
      conditions.push({ field: 'ref_no', op: '=', value: filters.refNo })
    }
    const { clause, values } = buildWhereClause(conditions)
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute(
        `SELECT * FROM \`inventory_flow\` ${clause} ORDER BY flow_date DESC, id DESC`,
        values
      )
      return rows
    } finally {
      release()
    }
  }

  // ---------- 月度快照 ----------

  /**
   * 批量写入月度快照（模拟器调用）
   * @param {Array<Object|Array>} rows 行数据
   * @param {Function} [onProgress] 进度回调 (written, total)
   * @returns {Promise<number>} 写入行数
   */
  async batchCreateSnapshots(rows, onProgress) {
    return batchInsert('inventory_snapshot', SNAPSHOT_COLUMNS, rows, { onProgress })
  }

  /**
   * 快照列表，支持按物料 / 账期过滤
   * @param {{ materialId?: number, period?: string, periodFrom?: string, periodTo?: string }} filters
   * @returns {Object[]} 按账期升序
   */
  async listSnapshots(filters = {}) {
    const conditions = []
    if (filters.materialId) {
      conditions.push({ field: 'material_id', op: '=', value: filters.materialId })
    }
    if (filters.period) {
      conditions.push({ field: 'period', op: '=', value: filters.period })
    }
    if (filters.periodFrom) {
      conditions.push({ field: 'period', op: '>=', value: filters.periodFrom })
    }
    if (filters.periodTo) {
      conditions.push({ field: 'period', op: '<=', value: filters.periodTo })
    }
    const { clause, values } = buildWhereClause(conditions)
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute(
        `SELECT * FROM \`inventory_snapshot\` ${clause} ORDER BY period ASC, material_id ASC`,
        values
      )
      return rows
    } finally {
      release()
    }
  }

  /**
   * 查询某物料某账期的快照（唯一键命中，最多一条）
   * @param {string} period 账期 YYYY-MM
   * @param {number} materialId 物料 ID
   * @returns {Object|null}
   */
  async findSnapshot(period, materialId) {
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute(
        'SELECT * FROM `inventory_snapshot` WHERE period = ? AND material_id = ? LIMIT 1',
        [period, materialId]
      )
      return rows[0] || null
    } finally {
      release()
    }
  }

  /**
   * 取某物料在指定账期之前的最后一期快照（用于逐月串联期初数量）
   * @param {number} materialId 物料 ID
   * @param {string} period 账期 YYYY-MM（不含该期）
   * @returns {Object|null}
   */
  async findLatestSnapshotBefore(materialId, period) {
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute(
        `SELECT * FROM \`inventory_snapshot\`
         WHERE material_id = ? AND period < ?
         ORDER BY period DESC LIMIT 1`,
        [materialId, period]
      )
      return rows[0] || null
    } finally {
      release()
    }
  }

  // 统计流水总数（数据总览用）
  async countFlows() {
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute('SELECT COUNT(*) AS total FROM `inventory_flow`')
      return rows[0] ? Number(rows[0].total) : 0
    } finally {
      release()
    }
  }

  // 统计快照总数（数据总览用）
  async countSnapshots() {
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute('SELECT COUNT(*) AS total FROM `inventory_snapshot`')
      return rows[0] ? Number(rows[0].total) : 0
    } finally {
      release()
    }
  }

  /**
   * 取最新账期的全部物料快照（库存健康度的「当期视图」）。
   * 先取最大账期再查该期数据，而不是用「当前时间」推算账期——
   * 后者在某个月恰好没有生成快照时会查出空结果。
   * 顺带 JOIN 物料表带出编码 / 名称 / ABC 分类，省掉上层再查一次。
   * @returns {Promise<Object[]>}
   */
  async getLatestSnapshots() {
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.query(
        `SELECT sn.*, m.code, m.name, m.category, m.unit, m.abc_class, m.reorder_point, m.moq
         FROM \`inventory_snapshot\` sn
         JOIN \`material\` m ON m.id = sn.material_id
         WHERE sn.period = (SELECT MAX(period) FROM \`inventory_snapshot\`)
         ORDER BY m.code ASC`
      )
      return rows
    } finally {
      release()
    }
  }

  /**
   * 按物料汇总出库量与出库金额（周转率的分子）。
   * @param {{ months?: number }} [options] months 传值时只统计最近 N 个月
   * @returns {Promise<Object[]>}
   */
  async getOutboundSummary(options = {}) {
    const values = []
    let windowClause = ''
    if (options.months > 0) {
      windowClause = 'AND flow_date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)'
      values.push(options.months)
    }
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.query(
        `SELECT material_id,
                COALESCE(SUM(qty), 0) AS out_qty,
                COALESCE(SUM(amount), 0) AS out_amount
         FROM \`inventory_flow\`
         WHERE flow_type = 'out' ${windowClause}
         GROUP BY material_id`,
        values
      )
      return rows
    } finally {
      release()
    }
  }

  /**
   * 按物料取最后一次出库日期，用于判断「近 N 天无出库」（呆滞的组合条件之一）。
   * @returns {Promise<Object[]>} 元素含 material_id 与 last_out_date
   */
  async getLastOutboundDates() {
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.query(
        `SELECT material_id, MAX(flow_date) AS last_out_date
         FROM \`inventory_flow\`
         WHERE flow_type = 'out'
         GROUP BY material_id`
      )
      return rows
    } finally {
      release()
    }
  }

  /**
   * 按物料取平均库存（周转率的分母：期间出库金额 ÷ 平均库存金额）。
   * period_count 一并返回，供上层把「期数」换算成天数。
   * @returns {Promise<Object[]>}
   */
  async getAverageSnapshotByMaterial() {
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.query(
        `SELECT material_id,
                AVG(amount) AS avg_amount,
                AVG(end_qty) AS avg_qty,
                COUNT(*) AS period_count
         FROM \`inventory_snapshot\`
         GROUP BY material_id`
      )
      return rows
    } finally {
      release()
    }
  }
}

// 导出单例
module.exports = new InventoryRepository()
