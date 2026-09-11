<template>
  <LandingPage
    title="供应商绩效"
    desc="回答「哪家供应商不靠谱」。用准时交付率（OTD）衡量交付可靠性、用来料不良率（PPM）衡量来料质量，
          两者一起看才能分清「偶尔延迟但质量稳定」和「既不准时又常出次品」的供应商。"
    :stats="stats"
    :entries="entries"
    :notes="notes"
    :error="error"
  />
</template>

<script setup>
// 供应商绩效 —— 模块落地页：说明 + 速览 + 快捷入口 + 口径说明。
import { ref, onMounted } from 'vue'
import LandingPage from '../../components/module-landing/LandingPage.vue'
import { getSupplierMetrics } from '../../api'

const error = ref('')
const stats = ref([])

// 快捷入口：进入本模块的两个功能页
const entries = [
  {
    key: 'supplier-overview',
    title: '绩效总览',
    desc: '按准时交付率升序排出供应商名次，配合不良率与综合评分，一眼看出该约谈哪几家。'
  },
  {
    key: 'supplier-detail',
    title: '交付与质量明细',
    desc: '逐单核对承诺交期与实际到货日、每批来料的合格与不良数量，可按供应商和是否延迟筛选。'
  }
]

// 口径说明：把「怎么算的」讲清楚，避免只看结论不知道由来
const notes = [
  '准时交付率（OTD）= 准时到货订单数 ÷ 已到货订单数。在途未到货的订单不参与分母，否则会虚低。',
  '来料不良率（PPM）= 不良数量 ÷ 到货数量 × 1,000,000。不良品不入库，因此入库量对应的是合格数量。',
  '综合评分 = 准时率 × 60% + 质量得分 × 40%。质量得分按 PPM 线性折算，10000 PPM（即 1% 不良）得 0 分。',
  '预警线：OTD 低于 90% 或 PPM 高于 5000，即判定为需关注供应商。'
]

onMounted(async () => {
  try {
    const res = await getSupplierMetrics({})
    if (!res || !res.success) {
      error.value = (res && res.message) || '读取供应商指标失败'
      return
    }
    const list = res.items || []
    const withOtd = list.filter((s) => s.otdRate !== null)
    const avgOtd = withOtd.length ? withOtd.reduce((a, s) => a + s.otdRate, 0) / withOtd.length : null
    // 需关注数量：与预警线保持同一口径
    const risky = list.filter(
      (s) => (s.otdRate !== null && s.otdRate < 0.9) || (s.ppm !== null && s.ppm > 5000)
    ).length

    stats.value = [
      { label: '供应商总数', value: list.length },
      { label: '平均准时交付率', value: avgOtd === null ? '—' : (avgOtd * 100).toFixed(1) + '%' },
      { label: '需关注供应商', value: risky, tone: risky > 0 ? 'warn' : 'ok' }
    ]
  } catch (e) {
    error.value = e && e.message ? e.message : '读取供应商指标失败'
  }
})
</script>
