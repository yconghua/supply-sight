/**
 * 供应商仓库（Repository Layer）—— 对应 `supplier` 表
 *
 * 继承 BaseRepository 获得通用 CRUD；
 * 供应商列表 / 按编码查询 / 批量写入在此以裸 SQL 表达。
 * 阶段 0 只提供基础查询与批量写入，绩效聚合查询（OTD、PPM）留到指标层实现。
 *
 * 导出单例：全局共用同一个仓库实例。
 */
const BaseRepository = require('./BaseRepository')
const { buildWhereClause } = require('./queryHelpers')
const { batchInsert } = require('./batchInserter')

// 批量写入时的列顺序（模拟器按此顺序组织行数据）
const SUPPLIER_COLUMNS = [
  'code',
  'name',
  'category',
  'contact_person',
  'phone',
  'credit_level',
  'payment_days',
  'status'
]

class SupplierRepository extends BaseRepository {
  constructor() {
    // 绑定到物理表 `supplier`
    super('supplier')
  }

  /**
   * 按供应商编码查询
   * @param {string} code 供应商编码
   * @returns {Object|null}
   */
  async findByCode(code) {
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute('SELECT * FROM `supplier` WHERE code = ?', [code])
      return rows[0] || null
    } finally {
      release()
    }
  }

  /**
   * 供应商列表，支持按状态 / 类别 / 关键字过滤
   * @param {{ status?: string, category?: string, keyword?: string }} filters
   * @returns {Object[]} 按编码升序
   */
  async list(filters = {}) {
    const conditions = []
    if (filters.status) {
      conditions.push({ field: 'status', op: '=', value: filters.status })
    }
    if (filters.category) {
      conditions.push({ field: 'category', op: '=', value: filters.category })
    }
    if (filters.keyword) {
      // 关键字模糊匹配名称（值经 ? 占位，安全）
      conditions.push({ field: 'name', op: 'LIKE', value: `%${filters.keyword}%` })
    }
    const { clause, values } = buildWhereClause(conditions)
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute(
        `SELECT * FROM \`supplier\` ${clause} ORDER BY code ASC`,
        values
      )
      return rows
    } finally {
      release()
    }
  }

  /**
   * 全量供应商（按编码升序），供下拉选择与指标计算使用
   * @returns {Object[]}
   */
  async listAll() {
    return this.list({})
  }

  /**
   * 批量写入供应商（模拟器调用）
   * @param {Array<Object|Array>} rows 行数据
   * @param {Function} [onProgress] 进度回调 (written, total)
   * @returns {Promise<number>} 写入行数
   */
  async batchCreate(rows, onProgress) {
    return batchInsert('supplier', SUPPLIER_COLUMNS, rows, { onProgress })
  }

  // 统计供应商总数（数据总览用）
  async count() {
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute('SELECT COUNT(*) AS total FROM `supplier`')
      return rows[0] ? Number(rows[0].total) : 0
    } finally {
      release()
    }
  }

  /**
   * 供应商绩效聚合（供应商绩效模块与预警规则共用的唯一数据源）。
   * 一次查出每家供应商的订单数、准时单数、到货量、不良量与平均延迟，
   * OTD 与 PPM 这两个核心口径的「分子分母」都在这里用 SQL 算出来，避免上层各算各的。
   *
   * 窗口条件刻意写在 LEFT JOIN 的 ON 里而不是 WHERE：
   * 这样即使某家供应商在窗口内没有订单，它依然会出现在结果里（各项为 0），
   * 页面不会因为「供应商突然消失」而产生误会。
   *
   * @param {{ months?: number }} [options] months 传值时只统计最近 N 个月（对应规则的 window_months）
   * @returns {Promise<Object[]>}
   */
  async getPerformanceMetrics(options = {}) {
    const values = []
    let windowClause = ''
    if (options.months > 0) {
      windowClause = 'AND po.order_date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)'
      values.push(options.months)
    }
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.query(
        `SELECT s.id, s.code, s.name, s.category, s.credit_level, s.payment_days,
                COUNT(DISTINCT po.id) AS order_count,
                COUNT(DISTINCT CASE WHEN po.actual_date IS NOT NULL THEN po.id END) AS received_count,
                COUNT(DISTINCT CASE WHEN po.actual_date IS NOT NULL AND po.actual_date <= po.promised_date
                                    THEN po.id END) AS on_time_count,
                COALESCE(SUM(poi.received_qty), 0) AS received_qty,
                COALESCE(SUM(poi.qualified_qty), 0) AS qualified_qty,
                COALESCE(SUM(poi.defect_qty), 0) AS defect_qty,
                COALESCE(SUM(poi.amount), 0) AS total_amount,
                COALESCE(AVG(CASE WHEN po.actual_date IS NOT NULL
                                  THEN DATEDIFF(po.actual_date, po.promised_date) END), 0) AS avg_delay_days
         FROM \`supplier\` s
         LEFT JOIN \`purchase_order\` po ON po.supplier_id = s.id ${windowClause}
         LEFT JOIN \`purchase_order_item\` poi ON poi.order_id = po.id
         GROUP BY s.id, s.code, s.name, s.category, s.credit_level, s.payment_days
         ORDER BY s.code ASC`,
        values
      )
      return rows
    } finally {
      release()
    }
  }
}

// 导出单例
module.exports = new SupplierRepository()
