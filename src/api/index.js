// 对 preload 暴露的 window.api 做一层薄封装，便于组件调用。
// 若需要，可在此统一处理错误 / loading。

export function login(username, password) {
  // 拼成单个对象再传，匹配 preload 工厂「每方法至多一个 payload 对象」的约定
  return window.api.auth.login({ username, password })
}

export function logout() {
  return window.api.auth.logout()
}

export function getCurrentUser() {
  return window.api.auth.getCurrentUser()
}

export function changePassword(username, oldPassword, newPassword) {
  // 拼成单个对象再传，匹配 preload 工厂「每方法至多一个 payload 对象」的约定
  return window.api.auth.changePassword({ username, oldPassword, newPassword })
}

// 用户管理
export function listUsers() {
  return window.api.auth.listUsers()
}

export function createUser(payload) {
  return window.api.auth.createUser(payload)
}

export function updateUser(payload) {
  return window.api.auth.updateUser(payload)
}

export function deleteUser(id) {
  // 拼成单个对象 { id } 再传，匹配 preload 工厂「每方法至多一个 payload 对象」的约定
  return window.api.auth.deleteUser({ id })
}

// 系统管理（系统名称 / 版本号 / 数据库信息）
export function getSysInfo() {
  return window.api.sys.info()
}

export function getDbInfo() {
  return window.api.sys.dbInfo()
}

// 查看数据表（当前库所有表 + 字段 + 行数）
export function getTablesInfo() {
  return window.api.sys.tablesInfo()
}

// 清理本地缓存（Electron 会话 / 磁盘缓存；localStorage 由前端自行处理）
export function clearCache() {
  return window.api.sys.clearCache()
}

// 用户数据目录（路径展示 + 在系统文件管理器中打开）
export function getUserDataPath() {
  return window.api.sys.userDataPath()
}

export function openUserDataDir() {
  return window.api.sys.openUserDataDir()
}

// 程序文件所在目录（路径展示 + 在系统文件管理器中打开）
export function getAppPath() {
  return window.api.sys.appPath()
}

export function openAppDir() {
  return window.api.sys.openAppDir()
}

// 导出当前库为 SQL 备份文件（弹出保存对话框，由主进程完成）
export function exportDatabase() {
  return window.api.sys.exportDb()
}

// 打开开发者控制台（DevTools）：独立窗口弹出，查看日志 / 网络请求与调试
export function openDevTools() {
  return window.api.sys.openDevTools()
}

// 手动检查更新（GitHub Releases）：返回当前版本 / 最新版本 / 是否有更新 / 变更说明
export function checkForUpdates() {
  return window.api.sys.checkForUpdates()
}

// 数据库连接管理（清单 / 切换 / 新增 / 删除）
export function getDbConnections() {
  return window.api.sys.dbConnections()
}

export function switchDb(id) {
  // 拼成单个对象 { id } 再传，匹配 preload 工厂「每方法至多一个 payload 对象」的约定
  return window.api.sys.switchDb({ id })
}

export function addDb(payload) {
  return window.api.sys.addDb(payload)
}

export function deleteDb(id) {
  // 拼成单个对象 { id } 再传，匹配 preload 工厂「每方法至多一个 payload 对象」的约定
  return window.api.sys.deleteDb({ id })
}

// 供应链业务：数据总览（9 张业务表的存在性与行数）
export function getSupplyOverview() {
  return window.api.supply.overview()
}

// 供应链业务：最近一次数据生成记录（种子 / 规模 / 自检结果）
export function getLatestSimRun() {
  return window.api.supply.latestRun()
}

// 数据模拟器：启动一次生成（立即返回，真正的生成在后台进行，用 getSimStatus 轮询进度）
export function startSimGenerate(payload) {
  return window.api.supply.simGenerate(payload)
}

// 数据模拟器：查询生成状态与进度
export function getSimStatus() {
  return window.api.supply.simStatus()
}

// 数据模拟器：生成历史列表
export function getSimHistory(limit) {
  // 拼成单个对象再传，匹配 preload 工厂「每方法至多一个 payload 对象」的约定
  return window.api.supply.simHistory({ limit })
}

// 供应商绩效指标（OTD / PPM / 平均延迟 / 综合评分）
export function getSupplierMetrics(payload) {
  return window.api.supply.supplierMetrics(payload)
}

// 库存健康度指标（期末金额 / 周转天数 / 呆滞 / ABC）
export function getInventoryMetrics(payload) {
  return window.api.supply.inventoryMetrics(payload)
}

// 采购成本指标（加权均价 / 价格指数 / 月度序列）
export function getCostMetrics(payload) {
  return window.api.supply.costMetrics(payload)
}

// 订单明细（交付与质量明细页）
export function getOrderList(payload) {
  return window.api.supply.orderList(payload)
}

// 首页概览（三个模块的关键数字汇总）
export function getDashboard() {
  return window.api.supply.dashboard()
}

// 预警中心：执行一次全量规则扫描
export function scanAlerts() {
  return window.api.supply.alertScan()
}

// 预警中心：预警记录列表
export function getAlertRecords(payload) {
  return window.api.supply.alertRecords(payload)
}

// 预警中心：更新处理状态
export function updateAlertStatus(payload) {
  return window.api.supply.alertUpdate(payload)
}

// 预警中心：规则清单（只读）
export function getAlertRules(payload) {
  return window.api.supply.alertRules(payload)
}
