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
}

// 导出单例
module.exports = new SupplierRepository()
