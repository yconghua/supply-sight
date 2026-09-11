<template>
  <div class="hp">
    <!-- ===== 1. 欢迎横幅：问候语与日期按当前时间实时生成 ===== -->
    <section class="hp-hero">
      <div class="hp-hero-inner">
        <h1 class="hp-greeting">{{ greeting }} 👋</h1>
        <p class="hp-date">{{ todayText }}</p>
        <p class="hp-hero-desc">
          链眼 · 供应链数据分析与预警系统 —— 用四个模块回答「库存压了多少钱、哪家供应商不靠谱、采购成本为什么降不下来」。
        </p>
      </div>
    </section>

    <!-- 加载失败提示：接口异常时如实告知，不拿占位数字糊弄 -->
    <p v-if="error" class="hp-err">{{ error }}</p>
    <p v-else-if="loading" class="hp-loading">正在读取数据…</p>

    <!-- ===== 2. 尚未生成数据时的引导 ===== -->
    <!-- 系统不预置任何示例数据，库里为空时明确引导去生成，而不是显示一堆 0 让人误解为「没有异常」 -->
    <section v-if="!loading && !error && !hasData" class="hp-guide">
      <div class="hp-guide-title">暂时没有可分析的数据</div>
      <p class="hp-guide-desc">
        本系统不预置示例数据。请先到「数据模拟器」按指定规模与随机种子生成一套具备统计特征的采购数据，
        四个业务模块才会有内容可看。
      </p>
      <RouterLink to="/simulator" class="hp-guide-btn">前往数据模拟器 →</RouterLink>
    </section>

    <template v-if="!loading && hasData">
      <!-- ===== 3. 三个业务问题：首页最先要回答的三件事 ===== -->
      <section class="hp-qs">
        <!-- 问题一：库存压了多少钱 -->
        <RouterLink to="/inventory" class="q-card">
          <div class="q-label">库存压了多少钱</div>
          <div class="q-value">¥{{ view.inventoryAmount }}</div>
          <div class="q-sub">
            其中呆滞占用 ¥{{ view.deadAmount }}<span class="q-dim">（{{ view.deadCount }} 项）</span>
          </div>
          <div class="q-foot">
            <span>平均周转 {{ view.turnoverDays }}</span>
            <span class="q-arrow">›</span>
          </div>
        </RouterLink>

        <!-- 问题二：哪家供应商不靠谱 -->
        <RouterLink to="/supplier" class="q-card">
          <div class="q-label">哪家供应商不靠谱</div>
          <div class="q-value q-value-sm">{{ view.riskyName }}</div>
          <div class="q-sub">
            准时交付率 <b :class="view.riskyOtdWarn ? 'q-bad' : 'q-ok'">{{ view.riskyOtd }}</b>
            <span class="q-dim">· {{ view.riskyPpm }}</span>
          </div>
          <div class="q-foot">
            <span>共 {{ view.supplierCount }} 家供应商，按准时率排序</span>
            <span class="q-arrow">›</span>
          </div>
        </RouterLink>

        <!-- 问题三：采购成本为什么降不下来 -->
        <RouterLink to="/cost" class="q-card">
          <div class="q-label">采购成本为什么降不下来</div>
          <div class="q-value">{{ view.priceIndex }}<span class="q-value-unit">价格指数</span></div>
          <div class="q-sub">
            较基期 <b :class="view.priceRiseWarn ? 'q-bad' : 'q-ok'">{{ view.priceRise }}</b>
            <span class="q-dim">· {{ view.risingCount }} 项涨超 5%</span>
          </div>
          <div class="q-foot">
            <span>累计采购 ¥{{ view.purchaseAmount }}</span>
            <span class="q-arrow">›</span>
          </div>
        </RouterLink>
      </section>

      <!-- ===== 4. 预警提示条：有未处理预警时才出现 ===== -->
      <RouterLink v-if="view.alertTotal > 0" to="/alert" class="hp-alert-bar">
        <span class="hp-alert-dot"></span>
        <span class="hp-alert-text">
          当前有 <b>{{ view.alertTotal }}</b> 条未处理预警：
          高 {{ view.alertHigh }} · 中 {{ view.alertMedium }} · 低 {{ view.alertLow }}
        </span>
        <span class="hp-alert-go">去处理 ›</span>
      </RouterLink>

      <!-- ===== 5. 关键指标：三个模块的核心数字一览 ===== -->
      <section class="hp-card">
        <div class="hp-card-header">
          <span class="hp-card-title">关键指标</span>
          <span class="hp-card-sub">数据截至 {{ view.periodEnd }}</span>
        </div>
        <div class="hp-metrics">
          <div class="m-item">
            <b>{{ view.supplierCount }}</b>
            <span>供应商</span>
          </div>
          <div class="m-item">
            <b>¥{{ view.inventoryAmount }}</b>
            <span>期末库存金额</span>
          </div>
          <div class="m-item">
            <b>{{ view.turnoverDays }}</b>
            <span>平均周转天数</span>
          </div>
          <div class="m-item" :class="{ warn: view.deadCountNum > 0 }">
            <b>{{ view.deadCount }}</b>
            <span>呆滞物料</span>
          </div>
          <div class="m-item">
            <b>¥{{ view.purchaseAmount }}</b>
            <span>累计采购金额</span>
          </div>
          <div class="m-item" :class="{ warn: view.risingCountNum > 0 }">
            <b>{{ view.risingCount }}</b>
            <span>涨价超 5% 物料</span>
          </div>
        </div>
      </section>

      <!-- ===== 6. 数据状态：说明「数据是造出来的」这件事本身，并给出可复现凭据 ===== -->
      <section class="hp-card">
        <div class="hp-card-header">
          <span class="hp-card-title">本次数据来源</span>
          <span class="hp-card-sub">
            勾稽自检
            <b :class="view.selfcheckPassed ? 'q-ok' : 'q-bad'">
              {{ view.hasSelfcheck ? (view.selfcheckPassed ? '通过' : '异常') : '—' }}
            </b>
          </span>
        </div>
        <p v-if="!view.hasRun" class="hp-card-empty">暂无生成记录，请先到「数据模拟器」生成数据。</p>
        <div v-else class="hp-chips">
          <span class="chip">运行编号 <b>{{ view.runNo }}</b></span>
          <span class="chip">随机种子 <b>{{ view.seed }}</b></span>
          <span class="chip">规模 <b>{{ view.scale }}</b></span>
          <span class="chip">期间 <b>{{ view.period }}</b></span>
          <span class="chip">订单 <b>{{ view.orderCount }}</b></span>
          <span class="chip">出入库流水 <b>{{ view.flowCount }}</b></span>
          <span class="chip">库存快照 <b>{{ view.snapshotCount }}</b></span>
          <span class="chip">生成时间 <b>{{ view.created }}</b></span>
        </div>
        <p class="hp-card-foot">
          数据由固定随机种子的推演引擎生成：同一种子两次生成结果完全一致，
          采购订单、出入库流水与月度库存快照三张表逐月勾稽相符。
        </p>
      </section>
    </template>

    <!-- ===== 7. 模块入口：四个业务模块的快捷通道 ===== -->
    <section class="hp-entries">
      <div class="hp-card-header">
        <span class="hp-card-title">业务模块</span>
      </div>
      <div class="entry-grid">
        <RouterLink to="/supplier" class="entry">
          <div class="entry-head">
            <span class="entry-title">供应商绩效</span>
            <span class="entry-arrow">›</span>
          </div>
          <p class="entry-desc">按准时交付率与来料不良率给供应商排名，找出该约谈的那几家。</p>
        </RouterLink>
        <RouterLink to="/inventory" class="entry">
          <div class="entry-head">
            <span class="entry-title">库存健康度</span>
            <span class="entry-arrow">›</span>
          </div>
          <p class="entry-desc">看期末库存金额、周转天数与呆滞占用，回答资金压在了哪里。</p>
        </RouterLink>
        <RouterLink to="/cost" class="entry">
          <div class="entry-head">
            <span class="entry-title">采购成本</span>
            <span class="entry-arrow">›</span>
          </div>
          <p class="entry-desc">用价格指数与加权均价追踪物料涨价，看清成本为何降不下来。</p>
        </RouterLink>
        <RouterLink to="/alert" class="entry">
          <div class="entry-head">
            <span class="entry-title">预警中心</span>
            <span class="entry-arrow">›</span>
          </div>
          <p class="entry-desc">按规则扫描三类异常（阈值型 / 趋势型 / 组合型），统一收口处理。</p>
        </RouterLink>
      </div>
    </section>
  </div>
</template>

<script setup>
// 首页：把三个业务问题的答案摊在最前面，再给出四个业务模块的入口。
// 数据来源——三处接口并行取回，全部读自主进程的指标服务，页面不做任何本地造数：
//   getDashboard()     三个模块的关键数字汇总（metricService.getOverview）
//   getLatestSimRun()  最近一次数据生成记录（种子 / 规模 / 条数 / 自检结果）
//   getAlertRecords()  未处理预警按严重度的数量汇总
import { ref, computed, onMounted } from 'vue'
import { getDashboard, getLatestSimRun, getAlertRecords } from '../../api'

const greeting = ref('') // 按小时段变化的问候语（如「早上好」「下午好」）
const todayText = ref('') // 今天日期 + 星期文案（如「2026年9月11日 星期五」）
const loading = ref(false)
const error = ref('')
const dash = ref(null) // 首页概览：三个模块的关键数字
const latestRun = ref(null) // 最近一次数据生成记录
const alertSummary = ref(null) // 未处理预警按严重度汇总 { high, medium, low }

// 星期中文名：new Date().getDay() 的索引（0=星期日 … 6=星期六）
const WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

// 构建顶部欢迎横幅：根据当前时间生成问候语与日期文案
function buildHero() {
  const d = new Date()
  const h = d.getHours()
  greeting.value = h < 6 ? '夜深了' : h < 9 ? '早上好' : h < 12 ? '上午好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好'
  todayText.value = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`
}

// JSON 列兼容：mysql2 有时把 JSON 列返回成字符串，统一解析成对象再使用。
// 不解析的话 run.row_counts.inventory_flow 会取到 undefined，页面上就成了空白。
function toObj(v) {
  if (!v) return null
  if (typeof v === 'string') {
    try {
      return JSON.parse(v)
    } catch (e) {
      return null
    }
  }
  return v
}

// 金额格式化：超过 1 万折成「万」，小金额保留整数
function money(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1) + ' 万'
  return n.toFixed(0)
}
// 数量格式化：千分位
function numText(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
// 百分比格式化：0.934 → 「93.4%」
function pct(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return (n * 100).toFixed(1) + '%'
}
// 天数格式化：保留整数
function days(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return Math.round(n) + ' 天'
}

// 是否有可展示的业务数据：至少要有供应商或库存金额，否则视为尚未生成
const hasData = computed(() => {
  const d = dash.value
  if (!d) return false
  return Number(d.supplierCount) > 0 || Number(d.inventoryAmount) > 0
})

// 页面展示值：统一在这里格式化完毕，模板只负责渲染。
// 这样模板里不会出现 null 访问，某个字段缺失时也只是显示「—」，不会整页报错。
const view = computed(() => {
  const d = dash.value || {}
  const a = alertSummary.value || { high: 0, medium: 0, low: 0 }
  const run = latestRun.value || null
  const rows = run ? toObj(run.row_counts) || {} : {}
  const selfcheck = run ? toObj(run.selfcheck) : null
  const risky = d.riskySupplier || null
  const high = Number(a.high) || 0
  const medium = Number(a.medium) || 0
  const low = Number(a.low) || 0

  return {
    // —— 三个业务问题 ——
    inventoryAmount: money(d.inventoryAmount),
    deadAmount: money(d.deadAmount),
    deadCount: d.deadCount === null || d.deadCount === undefined ? '—' : d.deadCount,
    deadCountNum: Number(d.deadCount) || 0,
    turnoverDays: days(d.avgTurnoverDays),
    riskyName: risky && risky.name ? risky.name : '暂无到货记录',
    riskyOtd: risky ? pct(risky.otdRate) : '—',
    // 准时率低于 90% 标红（与库里的预警规则同一口径）
    riskyOtdWarn: !!(risky && Number(risky.otdRate) < 0.9),
    riskyPpm: risky && risky.ppm !== null && risky.ppm !== undefined ? Math.round(risky.ppm) + ' PPM' : '— PPM',
    // —— 成本 ——
    priceIndex: d.avgPriceIndex === null || d.avgPriceIndex === undefined ? '—' : Number(d.avgPriceIndex).toFixed(3),
    priceRise: d.avgPriceIndex === null || d.avgPriceIndex === undefined ? '—' : ((Number(d.avgPriceIndex) - 1) * 100).toFixed(1) + '%',
    priceRiseWarn: d.avgPriceIndex !== null && d.avgPriceIndex !== undefined && Number(d.avgPriceIndex) > 1,
    purchaseAmount: money(d.purchaseAmount),
    risingCount: d.risingCount === null || d.risingCount === undefined ? 0 : d.risingCount,
    risingCountNum: Number(d.risingCount) || 0,
    supplierCount: d.supplierCount === null || d.supplierCount === undefined ? 0 : d.supplierCount,
    // —— 预警 ——
    alertHigh: high,
    alertMedium: medium,
    alertLow: low,
    alertTotal: high + medium + low,
    // —— 数据状态 ——
    hasRun: !!run,
    runNo: run ? run.run_no : '—',
    seed: run ? run.seed : '—',
    scale: run ? `${run.material_count} 物料 × ${run.supplier_count} 供应商` : '—',
    period: run ? `${run.start_date} ~ ${run.end_date}` : '—',
    periodEnd: run ? run.end_date : '—',
    orderCount: numText(rows.purchase_order),
    flowCount: numText(rows.inventory_flow),
    snapshotCount: numText(rows.inventory_snapshot),
    hasSelfcheck: !!selfcheck,
    selfcheckPassed: !!(selfcheck && selfcheck.passed),
    created: run && run.created_at ? String(run.created_at).replace('T', ' ').slice(0, 19) : '—'
  }
})

// 拉取首页所需的三处数据。
// 用 Promise.all 并行发起，三者互不依赖，串行会让首屏白等两轮往返。
async function load() {
  loading.value = true
  error.value = ''
  try {
    const [dashRes, runRes, alertRes] = await Promise.all([
      getDashboard(),
      getLatestSimRun(),
      getAlertRecords({})
    ])

    // 概览是首页的核心：失败就明确报错。
    // 这里刻意不用 0 兜底——把「读取失败」显示成「库存 0 元」会让人误以为一切正常。
    if (dashRes && dashRes.success) {
      dash.value = dashRes
    } else {
      error.value = (dashRes && dashRes.message) || '读取业务概览失败'
    }

    if (runRes && runRes.success) {
      latestRun.value = runRes.run || null
    }
    if (alertRes && alertRes.success) {
      alertSummary.value = alertRes.summary || { high: 0, medium: 0, low: 0 }
    }
  } catch (e) {
    error.value = e && e.message ? e.message : '读取业务概览失败'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  buildHero()
  load()
})
</script>

<style scoped>
.hp {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px 0 12px;
}

/* ===== 1. 欢迎横幅 ===== */
.hp-hero {
  border-radius: 16px;
  background: linear-gradient(135deg, #1a237e 0%, #0d47a1 100%);
  padding: 28px 32px;
  box-shadow: 0 8px 28px rgba(13, 71, 161, 0.25);
  position: relative;
  overflow: hidden;
}
.hp-hero::after {
  content: '⚛️';
  position: absolute;
  right: -10px;
  bottom: -40px;
  font-size: 180px;
  opacity: 0.06;
  transform: rotate(10deg);
}
.hp-hero-inner {
  position: relative;
  z-index: 1;
}
.hp-greeting {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  color: #fff;
}
.hp-date {
  margin: 8px 0 0;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
}
.hp-hero-desc {
  margin: 12px 0 0;
  font-size: 13px;
  line-height: 1.8;
  color: rgba(255, 255, 255, 0.9);
  max-width: 720px;
}

/* 状态提示 */
.hp-err {
  margin: 0;
  padding: 12px 16px;
  font-size: 13px;
  color: #c62828;
  background: #fdecea;
  border-radius: 10px;
}
.hp-loading {
  margin: 0;
  padding: 12px 16px;
  font-size: 13px;
  color: #8a9099;
  background: #fff;
  border: 1px solid #f0f2f5;
  border-radius: 10px;
}

/* ===== 2. 无数据引导 ===== */
.hp-guide {
  background: #fff;
  border: 1px dashed #d0d5dd;
  border-radius: 14px;
  padding: 36px 32px;
  text-align: center;
}
.hp-guide-title {
  font-size: 17px;
  font-weight: 700;
  color: #1d2129;
}
.hp-guide-desc {
  margin: 10px auto 20px;
  max-width: 620px;
  font-size: 13px;
  line-height: 1.9;
  color: #8a9099;
}
.hp-guide-btn {
  display: inline-block;
  padding: 9px 22px;
  font-size: 13px;
  color: #fff;
  background: #0d47a1;
  border-radius: 8px;
  text-decoration: none;
}
.hp-guide-btn:hover {
  background: #0b3d8c;
}

/* ===== 3. 三个业务问题 ===== */
.hp-qs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
.q-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #fff;
  border: 1px solid #f0f2f5;
  border-left: 3px solid #0d47a1;
  border-radius: 12px;
  padding: 18px 20px;
  text-decoration: none;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  transition: box-shadow 0.2s ease, transform 0.2s ease;
}
.q-card:hover {
  box-shadow: 0 6px 20px rgba(13, 71, 161, 0.12);
  transform: translateY(-2px);
}
.q-label {
  font-size: 12px;
  color: #8a9099;
}
.q-value {
  font-size: 26px;
  font-weight: 700;
  color: #0d47a1;
  line-height: 1.2;
}
.q-value-sm {
  font-size: 19px;
  color: #1d2129;
}
.q-value-unit {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 400;
  color: #a8b0b8;
}
.q-sub {
  font-size: 12px;
  color: #4a5158;
}
.q-dim {
  color: #a8b0b8;
}
.q-bad {
  color: #c62828;
}
.q-ok {
  color: #2e7d32;
}
.q-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 2px;
  padding-top: 10px;
  border-top: 1px solid #f5f6f8;
  font-size: 12px;
  color: #a8b0b8;
}
.q-arrow {
  font-size: 16px;
  color: #0d47a1;
  line-height: 1;
}

/* ===== 4. 预警提示条 ===== */
.hp-alert-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  background: #fff8f6;
  border: 1px solid #ffd9d1;
  border-radius: 10px;
  text-decoration: none;
}
.hp-alert-bar:hover {
  background: #fff3f0;
}
.hp-alert-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e53935;
  flex-shrink: 0;
}
.hp-alert-text {
  flex: 1;
  font-size: 13px;
  color: #7a3b30;
}
.hp-alert-text b {
  color: #c62828;
}
.hp-alert-go {
  font-size: 12px;
  color: #0d47a1;
  flex-shrink: 0;
}

/* ===== 5 / 6. 通用卡片 ===== */
.hp-card {
  background: #fff;
  border-radius: 12px;
  padding: 18px 22px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  border: 1px solid #f0f2f5;
}
.hp-card-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 14px;
}
.hp-card-title {
  font-size: 15px;
  font-weight: 600;
  color: #1d2129;
}
.hp-card-sub {
  font-size: 12px;
  color: #a8b0b8;
  flex-shrink: 0;
}
.hp-card-empty {
  margin: 0;
  padding: 20px 0;
  text-align: center;
  font-size: 13px;
  color: #8a9099;
}
.hp-card-foot {
  margin: 14px 0 0;
  font-size: 12px;
  line-height: 1.8;
  color: #a8b0b8;
}

/* 关键指标 */
.hp-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}
.m-item {
  background: #fafbfc;
  border-radius: 10px;
  padding: 14px 12px;
  text-align: center;
}
.m-item b {
  display: block;
  font-size: 18px;
  color: #0d47a1;
  font-weight: 700;
}
.m-item span {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: #8a9099;
}
.m-item.warn b {
  color: #c62828;
}

/* 数据状态标签 */
.hp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  padding: 6px 12px;
  font-size: 12px;
  color: #8a9099;
  background: #fafbfc;
  border: 1px solid #f0f2f5;
  border-radius: 20px;
}
.chip b {
  color: #4a5158;
  font-weight: 600;
}

/* ===== 7. 模块入口 ===== */
.hp-entries {
  background: #fff;
  border-radius: 12px;
  padding: 18px 22px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  border: 1px solid #f0f2f5;
}
.entry-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}
.entry {
  display: block;
  padding: 14px 16px;
  background: #fafbfc;
  border: 1px solid #f0f2f5;
  border-radius: 10px;
  text-decoration: none;
  transition: background 0.2s ease, border-color 0.2s ease;
}
.entry:hover {
  background: #f0f7ff;
  border-color: #cfe0f5;
}
.entry-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.entry-title {
  font-size: 14px;
  font-weight: 600;
  color: #1d2129;
}
.entry-arrow {
  font-size: 16px;
  color: #0d47a1;
  line-height: 1;
}
.entry-desc {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: #8a9099;
}

/* ===== 响应式（窗口较窄时收敛为单列） ===== */
@media (max-width: 900px) {
  .hp-qs {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 640px) {
  .hp-hero {
    padding: 22px 20px;
  }
  .hp-greeting {
    font-size: 22px;
  }
  .hp-card,
  .hp-entries {
    padding: 16px 18px;
  }
}
</style>
