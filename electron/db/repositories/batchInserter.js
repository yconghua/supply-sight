/**
 * 批量写入工具（Repository 层共用）
 *
 * 解决的问题：模拟器要一次性写入约 5 万条数据，若逐条 INSERT：
 *   - 每条一次网络往返 + 一次解析，本地 MySQL 也要几十秒；
 *   - 事务若整包提交，undo log 膨胀、锁等待变长，主进程的 IPC 响应会被拖住。
 *
 * 本工具的两个手段：
 *   1. 多行 VALUES：一条 INSERT 塞进去 chunkSize 行，把往返次数降为原来的 1/chunkSize；
 *   2. 分片提交：每片一条 INSERT 独立提交（一条 INSERT 本身即原子单元），
 *      片与片之间用 setImmediate 让出事件循环，长任务不会一直占着主进程。
 *
 * 关于用 query 而非 execute：批量插入走文本协议更快（省去预处理语句的
 * prepare / 缓存开销），且 mysql2 的 query 同样对占位符参数做转义，不存在注入风险。
 *
 * 为什么单独成文件而不加进 BaseRepository：保持既有基类零改动，
 * 且批量写入只有模拟器这一个使用方，放在基类里会给所有仓库增加无谓体积。
 */
const { acquireConn } = require('../connection')

// 默认每片行数：按单行约 200 字节估算，500 行约 100KB，
// 远低于 MySQL 默认 max_allowed_packet（4MB），既安全又能把往返次数压到最低。
const DEFAULT_CHUNK_SIZE = 500

/**
 * 把一行的某个列值规范化成可安全传给 mysql2 的值。
 * - undefined 一律转 null（否则 mysql2 会报错）；
 * - 其余原样返回（Date / 字符串 / 数字均由 mysql2 自行转换）。
 */
function normalizeValue(value) {
  return value === undefined ? null : value
}

/**
 * 从一行数据里按列名取值，兼容两种行结构：
 *   - 对象行：{ code: 'S001', name: 'xx' }
 *   - 数组行：[ 'S001', 'xx' ]（按 columns 顺序）
 */
function pickValue(row, column, columnIndex) {
  if (Array.isArray(row)) return row[columnIndex]
  if (row && typeof row === 'object') return row[column]
  return undefined
}

/**
 * 批量插入。
 * @param {string} table 表名（开发者代码里的可信常量，非用户输入）
 * @param {string[]} columns 列名数组（顺序即行数据取值顺序）
 * @param {Array<Object|Array>} rows 行数据（对象数组或二维数组）
 * @param {{ chunkSize?: number, onProgress?: Function }} [options]
 *        chunkSize：每片行数，默认 500；
 *        onProgress：(written, total) 每片写完回调一次，供页面显示进度。
 * @returns {Promise<number>} 实际写入行数
 */
async function batchInsert(table, columns, rows, options = {}) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('批量插入失败：columns 不能为空')
  }
  if (!Array.isArray(rows) || rows.length === 0) return 0

  const chunkSize = options.chunkSize > 0 ? options.chunkSize : DEFAULT_CHUNK_SIZE
  // 列名来自开发者代码（可信），仍用反引号包裹以兼容 order_no 之类不冲突但更稳妥的写法
  const columnClause = columns.map((c) => `\`${c}\``).join(', ')
  // 单行的占位符片段，形如 (?, ?, ?)，复用以减少字符串拼接
  const rowPlaceholder = `(${columns.map(() => '?').join(', ')})`

  const { conn, release } = await acquireConn()
  let written = 0
  try {
    for (let start = 0; start < rows.length; start += chunkSize) {
      const chunk = rows.slice(start, start + chunkSize)
      // 拼出多行 VALUES 片段，并把每行按列顺序摊平成参数数组
      const placeholders = chunk.map(() => rowPlaceholder).join(', ')
      const values = []
      for (const row of chunk) {
        for (let i = 0; i < columns.length; i++) {
          values.push(normalizeValue(pickValue(row, columns[i], i)))
        }
      }
      await conn.query(
        `INSERT INTO \`${table}\` (${columnClause}) VALUES ${placeholders}`,
        values
      )
      written += chunk.length
      if (typeof options.onProgress === 'function') {
        options.onProgress(written, rows.length)
      }
      // 让出事件循环：主进程是单线程的，长循环不主动让出会阻塞 IPC 响应
      await new Promise((resolve) => setImmediate(resolve))
    }
    return written
  } finally {
    release()
  }
}

/**
 * 清空一张表。模拟器每次重新生成前先清表，避免新旧两批数据混在一起导致勾稽错乱。
 * 用 TRUNCATE 而非 DELETE：TRUNCATE 会重置自增主键且速度更快，
 * 代价是无法回滚——对「重新生成」这个场景正合适。
 * @param {string} table 表名（可信常量）
 */
async function clearTable(table) {
  const { conn, release } = await acquireConn()
  try {
    await conn.query(`TRUNCATE TABLE \`${table}\``)
  } finally {
    release()
  }
}

/**
 * 按顺序清空多张表（模拟器重置数据用）。
 * @param {string[]} tables 表名数组（可信常量）
 */
async function clearTables(tables) {
  for (const table of tables) {
    await clearTable(table)
  }
}

module.exports = { batchInsert, clearTable, clearTables, DEFAULT_CHUNK_SIZE }
