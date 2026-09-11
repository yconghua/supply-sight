/**
 * 路由层（IPC Layer）—— 供应链业务路由（supply:* 前缀）
 *
 * 本模块承载供应链四大模块（供应商绩效 / 库存健康度 / 采购成本 / 预警中心）
 * 与数据模拟器的全部前端接口：
 *   - supply:overview      业务表总览（存在性与行数），用于确认数据结构是否就位；
 *   - supply:latest-run    最近一次数据生成记录（种子 / 规模 / 自检结果）；
 *   - supply:sim-generate  启动一次数据生成（立即返回，生成在后台进行）；
 *   - supply:sim-status    生成状态与进度（前端轮询）；
 *   - supply:sim-history   历史生成记录列表。
 *
 * 路由只做转发与登录态判定，真正的业务落在 supplyService / simulatorService；
 * 与 sys.js / auth.js 保持一致：需登录的接口在进业务前先校验会话。不在此处写 SQL。
 */
const authService = require('../services/authService')
const supplyService = require('../services/supplyService')
const simulatorService = require('../services/simulatorService')

// 注册所有 supply:* 路由。ipcMain 由 main.js 传入（经 ipc/index.js 聚合）。
function register(ipcMain) {
  // 业务总览：9 张表的存在性与行数；需登录
  ipcMain.handle('supply:overview', async () => {
    if (!authService.getCurrentUser()) {
      return { success: false, message: '未登录，请重新登录' }
    }
    return supplyService.getOverview()
  })

  // 最近一次数据生成记录；需登录
  ipcMain.handle('supply:latest-run', async () => {
    if (!authService.getCurrentUser()) {
      return { success: false, message: '未登录，请重新登录' }
    }
    return supplyService.getLatestRun()
  })

  // 启动数据生成：立即返回，真正的生成在后台异步执行，前端轮询 sim-status 查进度；需登录
  ipcMain.handle('supply:sim-generate', async (_evt, payload) => {
    if (!authService.getCurrentUser()) {
      return { success: false, message: '未登录，请重新登录' }
    }
    return simulatorService.startGenerate(payload || {})
  })

  // 生成状态与进度（阶段 / 百分比 / 上次结果 / 错误）；需登录
  ipcMain.handle('supply:sim-status', async () => {
    if (!authService.getCurrentUser()) {
      return { success: false, message: '未登录，请重新登录' }
    }
    return { success: true, ...simulatorService.getStatus() }
  })

  // 生成历史列表；需登录
  ipcMain.handle('supply:sim-history', async (_evt, payload) => {
    if (!authService.getCurrentUser()) {
      return { success: false, message: '未登录，请重新登录' }
    }
    const limit = payload && payload.limit ? payload.limit : 10
    return simulatorService.listHistory(limit)
  })
}

module.exports = { register }
