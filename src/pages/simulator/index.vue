<template>
  <div class="sim">
    <h2 class="page-title">数据模拟器</h2>

    <!-- ===== 说明 ===== -->
    <section class="card sim-intro">
      <p class="sim-intro-text">
        本系统没有企业真实数据，因此用统计方法生成一套<b>具备真实特征且勾稽自洽</b>的供应链数据：
        需求由「正弦函数模拟季节性 + 正态噪声」产生，供应商交付水平由正态分布刻画，
        采购价格按随机游走演进。采购订单由库存跌破订货点触发，入库流水由订单到货产生，
        月度快照由流水汇总——三张表因果相连，可用 SQL 直接核对。
      </p>
    </section>

    <!-- ===== 生成参数 ===== -->
    <section class="card">
      <div class="card-head">
        <h3 class="card-title">生成参数</h3>
      </div>
      <div class="form-grid">
        <label class="field">
          <span class="field-label">随机种子</span>
          <input v-model.number="form.seed" type="number" min="0" :disabled="running" />
          <span class="field-tip">同一种子生成的数据完全一致</span>
        </label>
        <label class="field">
          <span class="field-label">物料数量</span>
          <input v-model.number="form.materialCount" type="number" min="1" max="300" :disabled="running" />
          <span class="field-tip">1 ~ 300</span>
        </label>
        <label class="field">
          <span class="field-label">供应商数量</span>
          <input v-model.number="form.supplierCount" type="number" min="1" max="60" :disabled="running" />
          <span class="field-tip">1 ~ 60</span>
        </label>
        <label class="field">
          <span class="field-label">模拟月数</span>
          <input v-model.number="form.months" type="number" min="1" max="60" :disabled="running" />
          <span class="field-tip">1 ~ 60 个月</span>
        </label>
      </div>
      <div class="actions">
        <button class="btn-primary" :disabled="running" @click="handleStart">
          {{ running ? '生成中…' : '开始生成' }}
        </button>
        <span class="actions-hint">重新生成会清空现有业务数据（预警规则与生成历史保留）</span>
      </div>
    </section>

    <!-- ===== 进度 ===== -->
    <section v-if="running || percent > 0" class="card">
      <div class="card-head">
        <h3 class="card-title">生成进度</h3>
        <span class="card-sub">{{ phase }}</span>
      </div>
      <div class="progress">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: percent + '%' }"></div>
        </div>
        <span class="progress-percent">{{ percent }}%</span>
      </div>
      <p v-if="errorMsg" class="error-text">生成失败：{{ errorMsg }}</p>
    </section>

    <!-- ===== 勾稽自检 ===== -->
    <section v-if="result" class="card">
      <div class="card-head">
        <h3 class="card-title">勾稽自检</h3>
        <span class="card-sub" :class="result.selfcheck.passed ? 'ok' : 'bad'">
          {{ result.selfcheck.passed ? '全部通过' : '存在异常' }}
        </span>
      </div>
      <ul class="check-list">
        <li v-for="item in result.selfcheck.items" :key="item.key" :class="item.passed ? 'ok' : 'bad'">
          <span class="check-mark">{{ item.passed ? '✓' : '✗' }}</span>
          <span class="check-name">{{ item.name }}</span>
          <span class="check-detail">{{ item.detail }}</span>
        </li>
      </ul>
    </section>

    <!-- ===== 生成摘要 ===== -->
    <section v-if="result" class="card">
      <div class="card-head">
        <h3 class="card-title">本次生成</h3>
        <span class="card-sub">用时 {{ (result.durationMs / 1000).toFixed(1) }} 秒</span>
      </div>
      <div class="stat-row">
        <div class="stat-box">
          <span class="stat-value">{{ result.rowCounts.supplier }}</span>
          <span class="stat-label">供应商</span>
        </div>
        <div class="stat-box">
          <span class="stat-value">{{ result.rowCounts.material }}</span>
          <span class="stat-label">物料</span>
        </div>
        <div class="stat-box">
          <span class="stat-value">{{ result.rowCounts.purchase_order }}</span>
          <span class="stat-label">采购订单</span>
        </div>
        <div class="stat-box">
          <span class="stat-value">{{ result.rowCounts.inventory_flow }}</span>
          <span class="stat-label">出入库流水</span>
        </div>
        <div class="stat-box">
          <span class="stat-value">{{ result.rowCounts.inventory_snapshot }}</span>
          <span class="stat-label">库存快照</span>
        </div>
      </div>
      <p class="fingerprint">
        数据指纹 <code>{{ result.selfcheck.fingerprint }}</code>
        <span class="fingerprint-tip">用同一种子再生成一次，指纹应完全一致</span>
      </p>
    </section>

    <!-- ===== 埋点说明 ===== -->
    <section v-if="result && hasPlanted" class="card">
      <div class="card-head">
        <h3 class="card-title">本次埋点</h3>
        <span class="card-sub">为让三个业务问题有据可答，刻意制造的三类异常</span>
      </div>
      <div class="plant-list">
        <div v-if="result.profile.badSuppliers.length" class="plant-group">
          <span class="plant-tag tag-supplier">供应商不靠谱</span>
          <span class="plant-text">
            {{ result.profile.badSuppliers.map((s) => s.name).join('、') }}
            —— 平均延迟 {{ result.profile.badSuppliers[0].delayMean }} 天、不良率约
            {{ (result.profile.badSuppliers[0].defectRateMean * 100).toFixed(1) }}%
          </span>
        </div>
        <div v-if="result.profile.slowMaterials.length" class="plant-group">
          <span class="plant-tag tag-stock">库存积压</span>
          <span class="plant-text">
            {{ result.profile.slowMaterials.map((m) => m.name).join('、') }}
            —— 模拟产品停产后备件停止领用，起订量偏大导致库存长期积压
          </span>
        </div>
        <div v-if="result.profile.priceDriftMaterials.length" class="plant-group">
          <span class="plant-tag tag-cost">成本上涨</span>
          <span class="plant-text">
            {{ result.profile.priceDriftMaterials.map((m) => m.name).join('、') }}
            —— 单价每批次上浮 {{ (result.profile.priceDriftMaterials[0].driftPerOrder * 100).toFixed(1) }}%
          </span>
        </div>
      </div>
    </section>

    <!-- ===== 生成历史 ===== -->
    <section class="card">
      <div class="card-head">
        <h3 class="card-title">生成历史</h3>
      </div>
      <p v-if="!history.length" class="empty-text">暂无生成记录</p>
      <table v-else class="history-table">
        <thead>
          <tr>
            <th>运行编号</th>
            <th>种子</th>
            <th>期间</th>
            <th>流水条数</th>
            <th>自检</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="run in history" :key="run.id">
            <td class="mono">{{ run.run_no }}</td>
            <td class="mono">{{ run.seed }}</td>
            <td class="mono">{{ run.start_date }} ~ {{ run.end_date }}</td>
            <td class="mono">{{ run.row_counts ? run.row_counts.inventory_flow : '—' }}</td>
            <td>
              <span v-if="run.selfcheck" :class="run.selfcheck.passed ? 'ok' : 'bad'">
                {{ run.selfcheck.passed ? '通过' : '异常' }}
              </span>
              <span v-else>—</span>
            </td>
            <td>
              <span class="status" :class="run.status">
                {{ statusText(run.status) }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup>
// 数据模拟器页面：
// 配置生成参数 → 启动生成（后台进行）→ 轮询进度 → 展示勾稽自检与埋点说明 → 生成历史。
// 生成在主进程后台执行，本页只负责发起与展示，轮询间隔 600ms。
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { startSimGenerate, getSimStatus, getSimHistory } from '../../api'

// 生成参数表单（默认与后端 DEFAULTS 保持一致）
const form = reactive({
  seed: 20260911,
  materialCount: 60,
  supplierCount: 12,
  months: 24
})

const running = ref(false) // 是否正在生成
const phase = ref('') // 当前阶段文案
const percent = ref(0) // 进度百分比
const result = ref(null) // 本次生成结果（含自检与埋点）
const errorMsg = ref('') // 失败提示
const history = ref([]) // 生成历史

let timer = null // 轮询定时器

// 是否显示了埋点（三类埋点任意一类存在即展示该卡片）
const hasPlanted = computed(() => {
  if (!result.value || !result.value.profile) return false
  const p = result.value.profile
  return Boolean(
    (p.badSuppliers && p.badSuppliers.length) ||
      (p.slowMaterials && p.slowMaterials.length) ||
      (p.priceDriftMaterials && p.priceDriftMaterials.length)
  )
})

// 生成状态的中文文案
function statusText(status) {
  if (status === 'success') return '成功'
  if (status === 'failed') return '失败'
  if (status === 'running') return '进行中'
  return status || '—'
}

// 拉取生成历史
async function loadHistory() {
  try {
    const res = await getSimHistory(8)
    if (res && res.success) history.value = res.runs || []
  } catch (e) {
    // 历史读取失败不影响主流程（例如尚未建表），静默处理
  }
}

// 停止轮询
function stopPolling() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

// 开始轮询生成状态
function startPolling() {
  stopPolling()
  timer = setInterval(async () => {
    try {
      const st = await getSimStatus()
      if (!st || !st.success) return
      phase.value = st.phase || ''
      percent.value = st.percent || 0
      if (st.running) return
      // 生成结束：收尾并展示结果
      stopPolling()
      running.value = false
      if (st.lastError) {
        errorMsg.value = st.lastError
      }
      if (st.lastResult) {
        result.value = st.lastResult
      }
      loadHistory()
    } catch (e) {
      // 单次轮询失败不中断，下一轮继续
    }
  }, 600)
}

// 点击「开始生成」
async function handleStart() {
  if (running.value) return
  errorMsg.value = ''
  result.value = null
  percent.value = 0
  phase.value = '准备中'
  try {
    const res = await startSimGenerate({ ...form })
    if (!res || !res.success) {
      errorMsg.value = (res && res.message) || '启动失败'
      return
    }
    running.value = true
    startPolling()
  } catch (e) {
    errorMsg.value = e && e.message ? e.message : '启动失败'
  }
}

onMounted(() => {
  loadHistory()
})

// 离开页面务必停掉轮询，否则会持续占用主进程
onUnmounted(() => {
  stopPolling()
})
</script>

<style scoped>
.sim {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 8px;
}
.page-title {
  font-size: 18px;
  font-weight: 700;
  margin: 0;
  color: #1d2129;
}

/* ===== 通用卡片 ===== */
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
  font-size: 16px;
  font-weight: 600;
  color: #1d2129;
}
.card-sub {
  font-size: 12px;
  color: #8a9099;
}
.card-sub.ok {
  color: #2e7d32;
}
.card-sub.bad {
  color: #c62828;
}

/* ===== 说明 ===== */
.sim-intro {
  background: #f0f7ff;
  border-color: #d6e8ff;
}
.sim-intro-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.9;
  color: #37474f;
}
.sim-intro-text b {
  color: #0d47a1;
}

/* ===== 参数表单 ===== */
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px 24px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-label {
  font-size: 13px;
  color: #4a5158;
}
.field input {
  height: 34px;
  padding: 0 10px;
  font-size: 14px;
  color: #1d2129;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  outline: none;
  transition: border-color 0.2s;
}
.field input:focus {
  border-color: #0d47a1;
}
.field input:disabled {
  background: #f7f8fa;
  color: #a8b0b8;
}
.field-tip {
  font-size: 12px;
  color: #a8b0b8;
}

/* ===== 操作 ===== */
.actions {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 18px;
}
.btn-primary {
  height: 36px;
  padding: 0 24px;
  font-size: 14px;
  font-weight: 500;
  color: #fff;
  background: #0d47a1;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}
.btn-primary:hover:not(:disabled) {
  background: #1565c0;
}
.btn-primary:disabled {
  background: #a8b0b8;
  cursor: not-allowed;
}
.actions-hint {
  font-size: 12px;
  color: #a8b0b8;
}

/* ===== 进度 ===== */
.progress {
  display: flex;
  align-items: center;
  gap: 14px;
}
.progress-bar {
  flex: 1;
  height: 8px;
  background: #e8eaed;
  border-radius: 4px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, #0d47a1, #42a5f5);
  transition: width 0.4s ease;
}
.progress-percent {
  font-size: 14px;
  font-weight: 600;
  color: #0d47a1;
  flex-shrink: 0;
  width: 44px;
  text-align: right;
}
.error-text {
  margin: 12px 0 0;
  font-size: 13px;
  color: #c62828;
}

/* ===== 自检列表 ===== */
.check-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.check-list li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 13px;
  line-height: 1.7;
}
.check-mark {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border-radius: 50%;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
  color: #fff;
  margin-top: 1px;
}
.check-list li.ok .check-mark {
  background: #43a047;
}
.check-list li.bad .check-mark {
  background: #e53935;
}
.check-name {
  color: #1d2129;
  flex-shrink: 0;
}
.check-detail {
  color: #8a9099;
}

/* ===== 统计 ===== */
.stat-row {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
}
.stat-box {
  background: #f7f9fc;
  border: 1px solid #edf1f7;
  border-radius: 10px;
  padding: 14px 10px;
  text-align: center;
}
.stat-value {
  display: block;
  font-size: 20px;
  font-weight: 700;
  color: #0d47a1;
}
.stat-label {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: #8a9099;
}
.fingerprint {
  margin: 14px 0 0;
  font-size: 12px;
  color: #5f6a75;
}
.fingerprint code {
  padding: 2px 8px;
  background: #f2f4f7;
  border-radius: 6px;
  font-family: Consolas, Monaco, monospace;
  color: #0d47a1;
}
.fingerprint-tip {
  margin-left: 8px;
  color: #a8b0b8;
}

/* ===== 埋点 ===== */
.plant-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.plant-group {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 13px;
  line-height: 1.7;
}
.plant-tag {
  flex-shrink: 0;
  padding: 2px 10px;
  border-radius: 20px;
  font-size: 11px;
  color: #fff;
  margin-top: 2px;
}
.tag-supplier {
  background: #e53935;
}
.tag-stock {
  background: #fb8c00;
}
.tag-cost {
  background: #8e24aa;
}
.plant-text {
  color: #4a5158;
}

/* ===== 历史表 ===== */
.empty-text {
  margin: 0;
  font-size: 13px;
  color: #a8b0b8;
}
.history-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.history-table th {
  text-align: left;
  padding: 8px 10px;
  color: #8a9099;
  font-weight: 500;
  border-bottom: 1px solid #f0f2f5;
}
.history-table td {
  padding: 9px 10px;
  color: #4a5158;
  border-bottom: 1px solid #f7f8fa;
}
.history-table tr:last-child td {
  border-bottom: none;
}
.mono {
  font-family: Consolas, Monaco, monospace;
}
.ok {
  color: #2e7d32;
}
.bad {
  color: #c62828;
}
.status {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
}
.status.success {
  background: #e8f5e9;
  color: #2e7d32;
}
.status.failed {
  background: #ffebee;
  color: #c62828;
}
.status.running {
  background: #e3f2fd;
  color: #0d47a1;
}
</style>
