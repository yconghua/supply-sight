/**
 * 模拟运行记录仓库（Repository Layer）—— 对应 `sim_run` 表
 *
 * 记录每次数据生成的种子、规模、埋点配置与勾稽自检结果。
 * 存在的意义：让「同种子可复现」有据可查，并且能被页面上直接展示出来。
 *
 * JSON 列处理：profile / selfcheck / row_counts 三列为 MySQL JSON 类型，
 * 写入前若拿到的是对象则自动序列化（mysql2 不会替调用方做这件事）。
 *
 * 导出单例：全局共用同一个仓库实例。
 */
const BaseRepository = require('./BaseRepository')

// JSON 类型的列名集合，写入前需要序列化
const JSON_COLUMNS = ['profile', 'selfcheck', 'row_counts']

/**
 * 把对象类型的 JSON 列值转成字符串（已是字符串 / null / undefined 的原样返回）。
 * @param {Object} data 字段->值 映射
 * @returns {Object} 处理后的新对象
 */
function serializeJsonColumns(data) {
  const out = {}
  for (const [key, value] of Object.entries(data)) {
    if (JSON_COLUMNS.includes(key) && value !== null && value !== undefined && typeof value === 'object') {
      out[key] = JSON.stringify(value)
    } else {
      out[key] = value
    }
  }
  return out
}

class SimRunRepository extends BaseRepository {
  constructor() {
    // 绑定到物理表 `sim_run`
    super('sim_run')
  }

  /**
   * 新建一次生成记录（生成开始时调用，状态 running）
   * @param {Object} data 含 run_no / seed / material_count / supplier_count / start_date / end_date / profile
   * @returns {Promise<number>} 新记录 id
   */
  async createRun(data) {
    return this.create(serializeJsonColumns({ status: 'running', ...data }))
  }

  /**
   * 更新生成记录（生成完成 / 失败时调用，增量更新，未传字段保持原值）
   * @param {number} id 记录 id
   * @param {Object} data 可含 status / selfcheck / row_counts / message / finished_at
   * @returns {Promise<number>} 受影响行数
   */
  async updateRun(id, data) {
    return this.update(id, serializeJsonColumns(data))
  }

  /**
   * 取最近一次生成记录（页面进入时展示上次生成情况）
   * @returns {Object|null}
   */
  async findLatest() {
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute(
        'SELECT * FROM `sim_run` ORDER BY id DESC LIMIT 1'
      )
      return rows[0] || null
    } finally {
      release()
    }
  }

  /**
   * 生成历史列表
   * @param {number} [limit] 最多返回条数，默认 20
   * @returns {Object[]} 按创建时间倒序
   */
  async listRuns(limit = 20) {
    const { conn, release } = await this._acquire()
    try {
      // LIMIT 的值直接内联：limit 来自开发者代码的默认值或经 Number 归一化的入参，
      // 不用占位符是因为部分 MySQL 版本对 LIMIT ? 的预处理支持不一致
      const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 20
      const [rows] = await conn.execute(
        `SELECT * FROM \`sim_run\` ORDER BY id DESC LIMIT ${safeLimit}`
      )
      return rows
    } finally {
      release()
    }
  }

  // 统计生成记录总数（数据总览用）
  async count() {
    const { conn, release } = await this._acquire()
    try {
      const [rows] = await conn.execute('SELECT COUNT(*) AS total FROM `sim_run`')
      return rows[0] ? Number(rows[0].total) : 0
    } finally {
      release()
    }
  }
}

// 导出单例
module.exports = new SimRunRepository()
