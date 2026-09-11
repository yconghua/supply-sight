<template>
  <LandingPage
    title="预警中心"
    desc="前三个模块各自的异常，最终都要在这里收口。预警不是把指标再列一遍，
          而是按事先定好的规则把「越过阈值」的对象挑出来，给出实测值、阈值和一句能读懂的话。"
    :stats="stats"
    :entries="entries"
    :notes="notes"
    :error="error"
  />
</template>

<script setup>
// 预警中心 —— 模块落地页：说明 + 速览 + 快捷入口 + 口径说明。
import { ref, onMounted } from 'vue'
import LandingPage from '../../components/module-landing/LandingPage.vue'
import { getAlertRecords } from '../../api'

const error = ref('')
const stats = ref([])

const entries = [
  {
    key: 'alert-records',
    title: '预警列表',
    desc: '一键扫描全部规则，按模块、状态、严重度筛选命中结果，并可直接标记处理或忽略。'
  },
  {
    key: 'alert-rules',
    title: '预警规则',
    desc: '查看库里现有的规则配置与三类规则（阈值型 / 趋势型 / 组合型）的求值方式。'
  }
]

const notes = [
  '规则以 JSON 存在数据库里，引擎按类型分派求值器——新增一条规则只需要加一行配置，不用改代码。',
  '阈值型直接比大小；趋势型判断连续 N 期是否同向变化；组合型用「且 / 或」把多个条件组合起来。',
  '呆滞库存是组合型的典型用例：「周转天数 > 180」且「近 60 天无出库」同时成立才算，避免误杀正常慢销品。',
  '同一规则对同一对象的同一账期只保留一条记录，反复扫描只更新实测值，不会越堆越多。',
  '指标缺失时该条规则会被跳过——「无法判定」和「判定为不合格」是两回事。'
]

onMounted(async () => {
  try {
    const res = await getAlertRecords({})
    if (!res || !res.success) {
      error.value = (res && res.message) || '读取预警记录失败'
      return
    }
    const s = res.summary || { high: 0, medium: 0, low: 0 }
    stats.value = [
      { label: '高严重度未处理', value: s.high || 0, tone: s.high > 0 ? 'warn' : 'ok' },
      { label: '中严重度未处理', value: s.medium || 0 },
      { label: '低严重度未处理', value: s.low || 0 }
    ]
  } catch (e) {
    error.value = e && e.message ? e.message : '读取预警记录失败'
  }
})
</script>
