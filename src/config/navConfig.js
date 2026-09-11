// 左侧导航配置（数据驱动：父项 / 子项 / 顶部项的数量均可自由增减）
//
// - 顶部项（topItem）：直接跳转的独立导航（如「首页」）；
// - 父项（group）：下拉分组标题，点击展开 / 收起其子项；分组 key 用于大导航点击跳转到分组落地页；
// - 子项（child）：实际可点击路由，页面位于 pages 对应的文件夹里的 vue。
//
// 想加导航，只改这个文件即可：
//   新增顶部项 → 往 navTopItems 加一个 { key, title }，并在 pages 对应的文件夹里面建页面
//   新增父项   → 往 navGroups 加一个 { key, title, children: [...] }，并建 pages/<大组文件夹>/index.vue 落地页
//   新增子项   → 往对应父项的 children 加一个 { key, title }，并在 pages 对应的文件夹里面建页面
//   key 会同时用作路由 path（如 home → /home），需保持唯一并与页面文件夹名一致。
//
// 顺序即业务顺序：先回答三个业务问题（供应商 / 库存 / 成本）与它们的汇合点（预警中心），
// 再是支撑这些数据的数据模拟器，最后是平台自身的介绍。

// 顶部独立导航项（直接跳转，非下拉分组）
export const navTopItems = [
  { key: 'home', title: '首页' }
]

// 下拉分组
// 子项 key 与页面文件一一对应：pages/<大组文件夹>/<语义名>.vue
export const navGroups = [
  // 业务问题一：哪家供应商不靠谱
  {
    key: 'supplier',
    title: '供应商绩效',
    children: [
      { key: 'supplier-overview', title: '绩效总览' },
      { key: 'supplier-detail', title: '交付与质量明细' }
    ]
  },
  // 业务问题二：库存压了多少钱
  {
    key: 'inventory',
    title: '库存健康度',
    children: [
      { key: 'inventory-overview', title: '库存总览' },
      { key: 'inventory-dead', title: '呆滞与周转' }
    ]
  },
  // 业务问题三：采购成本为什么降不下来
  {
    key: 'cost',
    title: '采购成本',
    children: [
      { key: 'cost-overview', title: '成本总览' },
      { key: 'cost-trend', title: '价格趋势' }
    ]
  },
  // 三个问题的汇合点：把异常统一收口成可处理的预警
  {
    key: 'alert',
    title: '预警中心',
    children: [
      { key: 'alert-records', title: '预警列表' },
      { key: 'alert-rules', title: '预警规则' }
    ]
  },
  // 数据来源：没有企业真实数据，用统计模拟造出具备真实特征的数据
  {
    key: 'simulator',
    title: '数据模拟器',
    children: [
      { key: 'sim-run', title: '模拟生成' }
    ]
  },
  // 另一条独立科研线，与供应链模块并存
  {
    key: 'evac',
    title: '应急疏散',
    children: [
      { key: 'evac-sim', title: '仿真模拟' }
    ]
  },
  {
    key: 'about',
    title: '关于平台',
    children: [
      { key: 'about-intro', title: '系统介绍' },
      { key: 'about-guide', title: '使用指南' },
      { key: 'about-feedback', title: '意见反馈' },
      { key: 'about-contact', title: '联系我们' }
    ]
  }
]

// 默认重定向：优先顶部项「首页」，否则回退到个人主页
export const defaultNavPath = navTopItems.length
  ? `/${navTopItems[0].key}`
  : '/profile'
