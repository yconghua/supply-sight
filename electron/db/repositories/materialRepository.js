/**
 * 物料仓库（Repository Layer）—— 对应 `material` 表
 *
 * 继承 BaseRepository 获得通用 CRUD；
 * 物料列表 / 按编码查询 / 批量写入 / ABC 分类回填在此以裸 SQL 表达。
 *
 * 导出单例：全局共用同一个仓库实例。
 */
const BaseRepository = require('./BaseRepository')
const { buildWhereClause } = require('./queryHelpers')
const { batchInsert } = require('./batchInserter')

// 批量写入时的列顺序（模拟器按此顺序组织行数据）
const MATERIAL_COLUMNS = [
  'code',
  'name',
  'category',
  'unit',
  'abc_class',
  'std_price',
  'safety_stock',
  'reorder_point',
  'moq',
  'lead_time_days',
  'status'
]

class MaterialRepository extends BaseRepository {
  constructor() {
    // 绑定到物理表 `material`
    super('material')
  }

  /**
   * 按物料编码查询
   * @param {string} code 物料编码
   * @returns {Object|null}
   */
  async findByCode(code) {
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute('SELECT * FROM `material` WHERE code = ?', [code])
      return rows[0] || null
    } finally {
      release()
    }
  }

  /**
   * 物料列表，支持按类别 / ABC 分类 / 关键字过滤
   * @param {{ category?: string, abcClass?: string, keyword?: string }} filters
   * @returns {Object[]} 按编码升序
   */
  async list(filters = {}) {
    const conditions = []
    if (filters.category) {
      conditions.push({ field: 'category', op: '=', value: filters.category })
    }
    if (filters.abcClass) {
      conditions.push({ field: 'abc_class', op: '=', value: filters.abcClass })
    }
    if (filters.keyword) {
      conditions.push({ field: 'name', op: 'LIKE', value: `%${filters.keyword}%` })
    }
    const { clause, values } = buildWhereClause(conditions)
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute(
        `SELECT * FROM \`material\` ${clause} ORDER BY code ASC`,
        values
      )
      return rows
    } finally {
      release()
    }
  }

  /**
   * 全量物料（按编码升序），供下拉选择与指标计算使用
   * @returns {Object[]}
   */
  async listAll() {
    return this.list({})
  }

  /**
   * 批量写入物料（模拟器调用）
   * @param {Array<Object|Array>} rows 行数据
   * @param {Function} [onProgress] 进度回调 (written, total)
   * @returns {Promise<number>} 写入行数
   */
  async batchCreate(rows, onProgress) {
    return batchInsert('material', MATERIAL_COLUMNS, rows, { onProgress })
  }

  /**
   * 按物料编码回填 ABC 分类。
   * ABC 依赖年消耗金额的帕累托分布，必须先有流水与单价才能算出来，
   * 因此模拟器分两步走：先建物料主数据，算完消耗金额后再回填分类。
   * @param {Array<{ code: string, abcClass: string }>} items 编码与分类的对照列表
   * @returns {Promise<number>} 受影响行数
   */
  async updateAbcClasses(items) {
    if (!Array.isArray(items) || items.length === 0) return 0
    const { conn, release } = await this._acquire()
    let affected = 0
    try {
      for (const item of items) {
        const [result] = await conn.execute(
          'UPDATE `material` SET abc_class = ? WHERE code = ?',
          [item.abcClass, item.code]
        )
        affected += result.affectedRows
      }
      return affected
    } finally {
      release()
    }
  }

  // 统计物料总数（数据总览用）
  async count() {
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute('SELECT COUNT(*) AS total FROM `material`')
      return rows[0] ? Number(rows[0].total) : 0
    } finally {
      release()
    }
  }
}

// 导出单例
module.exports = new MaterialRepository()
