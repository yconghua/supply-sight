<template>
  <div class="mod">
    <div class="mod-head">
      <div>
        <h2 class="mod-title">供应商绩效总览</h2>
        <p class="mod-desc">按准时交付率（OTD）与来料不良率（PPM）给供应商排序，回答「哪家供应商不靠谱」。</p>
      </div>
      <div class="mod-actions">
        <label class="chk"><input v-model="onlyRisky" type="checkbox" />只看需关注</label>
        <button class="btn-ghost" :disabled="loading" @click="load">{{ loading ? '加载中…' : '刷新' }}</button>
      </div>
    </div>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="!loading && !items.length && !error" class="empty">暂无数据。请先到「数据模拟器 → 模拟生成」生成一套数据。</p>

    <template v-if="items.length">
      <section class="stat-row">
        <div class="stat"><b>{{ summary.count }}</b><span>供应商</span></div>
        <div class="stat"><b>{{ fmtPct(summary.avgOtd) }}</b><span>平均准时交付率</span></div>
        <div class="stat"><b>{{ fmtPpm(summary.avgPpm) }}</b><span>平均来料不良率</span></div>
        <div class="stat"><b>¥{{ fmtMoney(summary.totalAmount) }}</b><span>累计采购金额</span></div>
        <div class="stat warn"><b>{{ summary.riskyCount }}</b><span>需关注供应商</span></div>
      </section>

      <section class="card">
        <div class="card-head">
          <h3 class="card-title">绩效排行（按准时交付率升序，最差的在最上面）</h3>
          <span class="card-sub">预警线：OTD &lt; 90% 或 PPM &gt; 5000</span>
        </div>
        <table class="tbl">
          <thead>
            <tr>
              <th>供应商</th>
              <th>类别</th>
              <th>订单数</th>
              <th class="th-wide">准时交付率</th>
              <th>来料不良率</th>
              <th>平均延迟</th>
              <th>采购金额</th>
              <th>综合评分</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in filtered" :key="s.id" :class="{ risky: isRisky(s) }">
              <td>
                <div class="cell-name">{{ s.name }}</div>
                <div class="cell-sub">{{ s.code }} · 信用 {{ s.creditLevel }} · 账期 {{ s.paymentDays }} 天</div>
              </td>
              <td>{{ s.category }}</td>
              <td>{{ s.orderCount }}</td>
              <td>
                <div class="bar-wrap">
                  <div class="bar" :style="{ width: barWidth(s.otdRate), background: otdColor(s.otdRate) }"></div>
                </div>
                <span class="bar-text">{{ fmtPct(s.otdRate) }}</span>
              </td>
              <td :class="{ bad: s.ppm !== null && s.ppm > 5000 }">{{ fmtPpm(s.ppm) }}</td>
              <td>{{ fmtDelay(s.avgDelayDays) }}</td>
              <td>¥{{ fmtMoney(s.totalAmount) }}</td>
              <td><b>{{ s.score === null ? '—' : s.score }}</b></td>
            </tr>
          </tbody>
        </table>
        <p class="footnote">
          准时交付率 = 准时到货订单数 ÷ 已到货订单数；来料不良率（PPM）= 不良数量 ÷ 到货数量 × 1,000,000。
          综合评分 = 准时率 × 60% + 质量得分 × 40%。
        </p>
      </section>
    </template>
  </div>
</template>

<script setup>
// 供应商绩效总览：汇总卡 + 绩效排行表。
// 数据全部来自主进程的 metricService.getSupplierMetrics，本页只负责展示与本地筛选。
import { ref, computed, onMounted } from 'vue'
import { getSupplierMetrics } from '../../api'

const items = ref([])
const loading = ref(false)
const error = ref('')
const onlyRisky = ref(false)

// 预警线（与库里的预警规则保持一致，便于用户对照理解）
const RISK_OTD = 0.9
const RISK_PPM = 5000

// 是否属于「需关注」：两项指标任一越过预警线
function isRisky(s) {
  return (s.otdRate !== null && s.otdRate < RISK_OTD) || (s.ppm !== null && s.ppm > RISK_PPM)
}

// 按 OTD 升序排序：最差的排前面，问题一目了然
const filtered = computed(() => {
  const list = onlyRisky.value ? items.value.filter(isRisky) : items.value
  return [...list].sort((a, b) => {
    const av = a.otdRate === null ? 2 : a.otdRate
    const bv = b.otdRate === null ? 2 : b.otdRate
    return av - bv
  })
})

// 顶部汇总
const summary = computed(() => {
  const list = items.value
  const withOtd = list.filter((s) => s.otdRate !== null)
  const withPpm = list.filter((s) => s.ppm !== null)
  return {
    count: list.length,
    avgOtd: withOtd.length ? withOtd.reduce((a, s) => a + s.otdRate, 0) / withOtd.length : null,
    avgPpm: withPpm.length ? withPpm.reduce((a, s) => a + s.ppm, 0) / withPpm.length : null,
    totalAmount: list.reduce((a, s) => a + s.totalAmount, 0),
    riskyCount: list.filter(isRisky).length
  }
})

function fmtPct(v) {
  return v === null || v === undefined ? '—' : (v * 100).toFixed(1) + '%'
}
function fmtPpm(v) {
  return v === null || v === undefined ? '—' : Math.round(v) + ' PPM'
}
function fmtMoney(v) {
  const n = Number(v) || 0
  if (n >= 10000) return (n / 10000).toFixed(1) + ' 万'
  return n.toFixed(0)
}
function fmtDelay(v) {
  const n = Number(v) || 0
  if (n > 0.05) return '延迟 ' + n.toFixed(1) + ' 天'
  if (n < -0.05) return '提前 ' + Math.abs(n).toFixed(1) + ' 天'
  return '基本准时'
}
// OTD 条形宽度：直接按比例，最低留 2% 以便看得见
function barWidth(rate) {
  if (rate === null || rate === undefined) return '0%'
  return Math.max(2, Math.min(100, rate * 100)) + '%'
}
// OTD 颜色：低于预警线标红，否则绿色（这里的红绿遵循国内习惯，红色代表告警）
function otdColor(rate) {
  if (rate === null || rate === undefined) return '#c9ced6'
  return rate < RISK_OTD ? '#e53935' : '#43a047'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await getSupplierMetrics({})
    if (!res || !res.success) {
      error.value = (res && res.message) || '读取供应商指标失败'
      items.value = []
      return
    }
    items.value = res.items || []
  } catch (e) {
    error.value = e && e.message ? e.message : '读取供应商指标失败'
    items.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.mod {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.mod-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.mod-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #1d2129;
}
.mod-desc {
  margin: 6px 0 0;
  font-size: 13px;
  color: #8a9099;
  line-height: 1.7;
}
.mod-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.chk {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #4a5158;
  cursor: pointer;
}
.btn-ghost {
  height: 32px;
  padding: 0 16px;
  font-size: 13px;
  color: #0d47a1;
  background: #fff;
  border: 1px solid #cfe0f5;
  border-radius: 8px;
  cursor: pointer;
}
.btn-ghost:hover:not(:disabled) {
  background: #f0f7ff;
}
.btn-ghost:disabled {
  color: #a8b0b8;
  border-color: #e4e7ec;
  cursor: not-allowed;
}
.err {
  margin: 0;
  padding: 12px 16px;
  font-size: 13px;
  color: #c62828;
  background: #fdecea;
  border-radius: 10px;
}
.empty {
  margin: 0;
  padding: 40px;
  text-align: center;
  font-size: 14px;
  color: #8a9099;
  background: #fff;
  border: 1px dashed #d0d5dd;
  border-radius: 12px;
}

/* 汇总卡 */
.stat-row {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
}
.stat {
  background: #fff;
  border: 1px solid #f0f2f5;
  border-radius: 12px;
  padding: 16px;
  text-align: center;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}
.stat b {
  display: block;
  font-size: 20px;
  color: #0d47a1;
}
.stat span {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: #8a9099;
}
.stat.warn b {
  color: #c62828;
}

/* 表格 */
.card {
  background: #fff;
  border: 1px solid #f0f2f5;
  border-radius: 12px;
  padding: 18px 22px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 14px;
  gap: 12px;
}
.card-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #1d2129;
}
.card-sub {
  font-size: 12px;
  color: #a8b0b8;
  flex-shrink: 0;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.tbl th {
  text-align: left;
  padding: 9px 10px;
  font-weight: 500;
  color: #8a9099;
  border-bottom: 1px solid #f0f2f5;
  white-space: nowrap;
}
.th-wide {
  width: 150px;
}
.tbl td {
  padding: 10px;
  color: #4a5158;
  border-bottom: 1px solid #f7f8fa;
  vertical-align: middle;
}
.tbl tr:last-child td {
  border-bottom: none;
}
.tbl tr.risky {
  background: #fffafa;
}
.cell-name {
  font-size: 13px;
  color: #1d2129;
  font-weight: 500;
}
.cell-sub {
  margin-top: 2px;
  font-size: 11px;
  color: #a8b0b8;
}
.bar-wrap {
  display: inline-block;
  width: 78px;
  height: 6px;
  background: #eef1f5;
  border-radius: 3px;
  overflow: hidden;
  vertical-align: middle;
}
.bar {
  height: 100%;
  border-radius: 3px;
}
.bar-text {
  margin-left: 8px;
  font-size: 12px;
  color: #4a5158;
}
.bad {
  color: #c62828;
  font-weight: 500;
}
.footnote {
  margin: 14px 0 0;
  font-size: 12px;
  color: #a8b0b8;
  line-height: 1.8;
}
</style>
