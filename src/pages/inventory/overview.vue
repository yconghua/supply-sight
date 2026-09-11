<template>
  <div class="mod">
    <div class="mod-head">
      <div>
        <h2 class="mod-title">库存总览</h2>
        <p class="mod-desc">
          用期末库存金额与周转天数回答「库存压了多少钱」，并用 ABC 分类看清资金集中在哪些物料上。
        </p>
      </div>
      <button class="btn-ghost" :disabled="loading" @click="load">{{ loading ? '加载中…' : '刷新' }}</button>
    </div>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="!loading && !items.length && !error" class="empty">暂无数据。请先到「数据模拟器 → 模拟生成」生成一套数据。</p>

    <template v-if="items.length">
      <section class="stat-row">
        <div class="stat"><b>¥{{ fmtMoney(summary.totalAmount) }}</b><span>期末库存金额</span></div>
        <div class="stat warn"><b>¥{{ fmtMoney(summary.deadAmount) }}</b><span>其中呆滞库存</span></div>
        <div class="stat"><b>{{ fmtRatio(summary.deadRatio) }}</b><span>呆滞金额占比</span></div>
        <div class="stat"><b>{{ fmtDays(summary.avgTurnoverDays) }}</b><span>平均周转天数</span></div>
        <div class="stat"><b>{{ summary.belowReorderCount }}</b><span>低于订货点的物料</span></div>
      </section>

      <section class="card">
        <div class="card-head">
          <h3 class="card-title">ABC 分类（按年消耗金额的帕累托 80 / 15 / 5）</h3>
          <span class="card-sub">账期 {{ summary.period }}</span>
        </div>
        <div class="abc-list">
          <div v-for="c in abcRows" :key="c.cls" class="abc-item">
            <span class="abc-tag" :class="'abc-' + c.cls">{{ c.cls }}</span>
            <div class="abc-bar-wrap">
              <div class="abc-bar" :class="'abc-' + c.cls" :style="{ width: c.width }"></div>
            </div>
            <span class="abc-text">{{ c.count }} 项 · ¥{{ fmtMoney(c.amount) }}（{{ c.share }}）</span>
          </div>
        </div>
        <p class="footnote">A 类物料数量少但占用资金最多，是库存管控的重点；C 类物料数量多但金额占比低，适合简化管理。</p>
      </section>

      <section class="card">
        <div class="card-head">
          <h3 class="card-title">物料库存明细（按库存金额降序）</h3>
          <span class="card-sub">共 {{ items.length }} 项</span>
        </div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>物料</th>
                <th>ABC</th>
                <th>期末数量</th>
                <th>期末单价</th>
                <th>库存金额</th>
                <th class="th-wide">资金占比</th>
                <th>周转天数</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="it in sorted" :key="it.materialId">
                <td>
                  <div class="cell-name">{{ it.name }}</div>
                  <div class="cell-sub">{{ it.code }} · {{ it.category }} · 订货点 {{ fmtNum(it.reorderPoint) }}</div>
                </td>
                <td><span class="abc-tag small" :class="'abc-' + it.abcClass">{{ it.abcClass }}</span></td>
                <td>{{ fmtNum(it.endQty) }} {{ it.unit }}</td>
                <td>¥{{ Number(it.unitPrice).toFixed(2) }}</td>
                <td>¥{{ fmtNum(it.amount) }}</td>
                <td>
                  <div class="bar-wrap">
                    <div class="bar" :style="{ width: barWidth(it.amount) }"></div>
                  </div>
                  <span class="bar-text">{{ barWidth(it.amount) }}</span>
                </td>
                <td>{{ fmtDays(it.turnoverDays) }}</td>
                <td>
                  <span v-if="it.isDead" class="badge dead">呆滞</span>
                  <span v-else-if="it.belowReorder" class="badge low">低于订货点</span>
                  <span v-else class="badge ok">正常</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
// 库存总览：汇总卡 + ABC 分布 + 物料库存明细。
// 数据来自主进程 metricService.getInventoryMetrics（已把周转天数、呆滞判定算好）。
import { ref, computed, onMounted } from 'vue'
import { getInventoryMetrics } from '../../api'

const items = ref([])
const summary = ref({})
const loading = ref(false)
const error = ref('')

// 按库存金额降序：占用资金最多的排最前
const sorted = computed(() => [...items.value].sort((a, b) => b.amount - a.amount))
const maxAmount = computed(() => Math.max(1, ...items.value.map((it) => it.amount)))

// ABC 三行展示，宽度按金额占比
const abcRows = computed(() => {
  const amount = summary.value.abcAmount || {}
  const count = summary.value.abcCount || {}
  const total = Object.values(amount).reduce((a, v) => a + v, 0) || 1
  return ['A', 'B', 'C'].map((cls) => {
    const amt = amount[cls] || 0
    const share = amt / total
    return {
      cls,
      amount: amt,
      count: count[cls] || 0,
      share: (share * 100).toFixed(1) + '%',
      width: Math.max(1, share * 100) + '%'
    }
  })
})

function fmtNum(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
function fmtMoney(v) {
  const n = Number(v) || 0
  if (n >= 10000) return (n / 10000).toFixed(1) + ' 万'
  return n.toFixed(0)
}
function fmtDays(v) {
  return v === null || v === undefined ? '—' : Math.round(v) + ' 天'
}
function fmtRatio(v) {
  return v === null || v === undefined ? '—' : (v * 100).toFixed(1) + '%'
}
function barWidth(amount) {
  return Math.max(1, Math.min(100, (Number(amount) / maxAmount.value) * 100)).toFixed(1) + '%'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await getInventoryMetrics({})
    if (!res || !res.success) {
      error.value = (res && res.message) || '读取库存指标失败'
      items.value = []
      return
    }
    items.value = res.items || []
    summary.value = res.summary || {}
  } catch (e) {
    error.value = e && e.message ? e.message : '读取库存指标失败'
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
.btn-ghost {
  height: 32px;
  padding: 0 16px;
  font-size: 13px;
  color: #0d47a1;
  background: #fff;
  border: 1px solid #cfe0f5;
  border-radius: 8px;
  cursor: pointer;
  flex-shrink: 0;
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
  font-size: 19px;
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
}

/* ABC */
.abc-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.abc-item {
  display: flex;
  align-items: center;
  gap: 12px;
}
.abc-tag {
  width: 24px;
  height: 24px;
  line-height: 24px;
  text-align: center;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  flex-shrink: 0;
}
.abc-tag.small {
  width: 20px;
  height: 20px;
  line-height: 20px;
  font-size: 11px;
}
.abc-A {
  background: #e53935;
}
.abc-B {
  background: #fb8c00;
}
.abc-C {
  background: #78909c;
}
.abc-bar-wrap {
  flex: 1;
  height: 10px;
  background: #f2f4f7;
  border-radius: 5px;
  overflow: hidden;
}
.abc-bar {
  height: 100%;
  border-radius: 5px;
}
.abc-text {
  font-size: 12px;
  color: #5f6a75;
  flex-shrink: 0;
  min-width: 190px;
  text-align: right;
}

/* 表格 */
.tbl-wrap {
  overflow-x: auto;
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
  width: 130px;
}
.tbl td {
  padding: 10px;
  color: #4a5158;
  border-bottom: 1px solid #f7f8fa;
  white-space: nowrap;
}
.tbl tr:last-child td {
  border-bottom: none;
}
.cell-name {
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
  width: 70px;
  height: 6px;
  background: #eef1f5;
  border-radius: 3px;
  overflow: hidden;
  vertical-align: middle;
}
.bar {
  height: 100%;
  background: #0d47a1;
  border-radius: 3px;
}
.bar-text {
  margin-left: 8px;
  font-size: 11px;
  color: #8a9099;
}
.badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
}
.badge.dead {
  background: #fdecea;
  color: #c62828;
}
.badge.low {
  background: #fff4e5;
  color: #b26a00;
}
.badge.ok {
  background: #e8f5e9;
  color: #2e7d32;
}
.footnote {
  margin: 14px 0 0;
  font-size: 12px;
  color: #a8b0b8;
  line-height: 1.8;
}
</style>
