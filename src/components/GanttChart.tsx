import { useMemo, useRef } from 'react'
import ReactECharts from 'echarts-for-react'
import dayjs from 'dayjs'
import { Empty, Space } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import type { ProcessRow, MilestoneRow } from '../types'

const DAY = 86400000

/** 实际进度条颜色（按工序状态） */
const STATUS_BAR_COLOR: Record<string, string> = {
  未开始: '#bfbfbf',
  进行中: '#1677ff',
  已完成: '#52c41a',
  已暂停: '#faad14',
}

interface GanttProps {
  processes: ProcessRow[]
  /** 里程碑（可选）：在时间轴顶部以菱形标记 */
  milestones?: MilestoneRow[]
  /** 点击某道工序的条形时回调（用于直接打开编辑） */
  onBarClick?: (p: ProcessRow) => void
}

/**
 * 工序甘特图（二期 M3-5）
 * - 横轴时间、纵轴工序；每行画「计划区间」（浅色底条）+「实际区间」（实色条）
 * - 里程碑以菱形标记在顶部专用行
 * - 支持 dataZoom 缩放 / 拖动，红色虚线为今天
 * 数据全部来自 listProcess / listMilestones，不新增后端接口。
 */
export default function GanttChart({ processes, milestones = [], onBarClick }: GanttProps) {
  const ref = useRef<ReactECharts | null>(null)

  const built = useMemo(() => {
    const today = dayjs().startOf('day')
    const todayTs = today.valueOf()
    const todayStr = today.format('YYYY-MM-DD')

    const isOverdue = (r: ProcessRow) =>
      r.status !== '已完成' && r.status !== '已暂停' && r.plan_end < todayStr

    // —— 时间范围：所有计划/实际日期 + 里程碑 + 今天，两端各留 padding ——
    const stamps: number[] = [todayTs]
    const push = (d?: string | null) => { if (d) stamps.push(dayjs(d).valueOf()) }
    processes.forEach((r) => { push(r.plan_start); push(r.plan_end); push(r.actual_start); push(r.actual_end) })
    milestones.forEach((m) => { push(m.plan_date); push(m.actual_date) })

    const minTs = Math.min(...stamps)
    const maxTs = Math.max(...stamps)
    const span = Math.max(maxTs - minTs, 7 * DAY)
    const pad = Math.max(span * 0.03, DAY)

    // —— 纵轴：里程碑占独立首行，工序按 seq 顺序 ——
    const hasMs = milestones.length > 0
    const yData = hasMs
      ? ['◆ 里程碑', ...processes.map((r, i) => `${r.seq_no ?? i + 1}. ${r.name}`)]
      : processes.map((r, i) => `${r.seq_no ?? i + 1}. ${r.name}`)
    const yOffset = hasMs ? 1 : 0

    const barData = processes.map((r, i) => {
      const ps = dayjs(r.plan_start).valueOf()
      const pe = dayjs(r.plan_end).valueOf()
      const as = r.actual_start ? dayjs(r.actual_start).valueOf() : null
      const ae = r.actual_end ? dayjs(r.actual_end).valueOf() : (as != null ? Math.min(todayTs, pe) : null)
      return { name: r.name, value: [ps, pe, as ?? ps, ae ?? pe, i + yOffset], raw: r }
    })

    const milestoneData = milestones.map((m) => ({
      name: m.name,
      value: [dayjs(m.plan_date).valueOf(), yData[0]],
      raw: m,
      itemStyle: {
        color: m.status === '已达成' ? '#52c41a' : (m.isOverdue ? '#ff4d4f' : '#722ed1'),
      },
    }))

    /** 手绘每个工序行：计划底条 + 实际进度条 + 完成率 */
    const renderItem = (params: any, api: any) => {
      // ECharts 在某些渲染阶段不会带 params.data，这里用 dataIndexInside 兜底
      const item = (params.data && params.data.raw)
        ? params.data
        : barData[params.dataIndexInside] || barData[params.dataIndex]
      if (!item || !item.raw) return { type: 'group', children: [] }
      const raw: ProcessRow = item.raw
      const idx = api.value(4)
      const psTs = dayjs(raw.plan_start).valueOf()
      const peTs = dayjs(raw.plan_end).valueOf()
      const yCenter = api.coord([psTs, idx])[1]
      const x0 = api.coord([psTs, idx])[0]
      const x1 = api.coord([peTs, idx])[0]
      const overdue = isOverdue(raw)
      const barH = 16
      const children: any[] = []

      // 计划区间
      children.push({
        type: 'rect',
        shape: { x: x0, y: yCenter - barH / 2, width: Math.max(x1 - x0, 2), height: barH, r: 3 },
        style: {
          fill: overdue ? 'rgba(255,77,79,0.10)' : 'rgba(22,119,255,0.12)',
          stroke: overdue ? '#ff7875' : '#91caff',
          lineWidth: 1,
        },
      })

      // 实际区间
      if (raw.actual_start) {
        const asTs = dayjs(raw.actual_start).valueOf()
        const aeTs = raw.actual_end ? dayjs(raw.actual_end).valueOf() : Math.min(todayTs, peTs)
        const ax0 = api.coord([asTs, idx])[0]
        const ax1 = api.coord([aeTs, idx])[0]
        children.push({
          type: 'rect',
          shape: { x: ax0, y: yCenter - 4, width: Math.max(ax1 - ax0, 2), height: 8, r: 4 },
          style: { fill: STATUS_BAR_COLOR[raw.status] || '#1677ff' },
        })
      }

      // 完成率（条右侧）
      const pct = Math.round((raw.ratio ?? 0) * 100)
      children.push({
        type: 'text',
        style: {
          text: `${pct}%`,
          x: x1 + 6,
          y: yCenter,
          align: 'left',
          verticalAlign: 'middle',
          fill: overdue ? '#cf1322' : '#0958d9',
          fontSize: 11,
          fontWeight: 600,
        },
      })

      return { type: 'group', children }
    }

    const rowCount = yData.length
    // 每道工序 40px，工序多时页面滚动，保证条形不被压扁
    const height = Math.min(Math.max(rowCount * 40 + 120, 320), 2000)

    const option: any = {
      animation: false,
      grid: { left: 168, right: 72, top: 62, bottom: 54 },
      tooltip: {
        trigger: 'item',
        confine: true,
        formatter: (p: any) => {
          const d = p.data || {}
          if (p.seriesName === '里程碑') {
            const m: MilestoneRow = d.raw
            if (!m) return ''
            return `<b>${m.name}</b><br/>计划：${m.plan_date}<br/>实际：${m.actual_date || '—'}<br/>状态：${m.status}`
          }
          const r: ProcessRow = d.raw
          if (!r) return ''
          const pct = Math.round((r.ratio ?? 0) * 100)
          return [
            `<b>${r.name}</b>`,
            `计划：${r.plan_start} ~ ${r.plan_end}`,
            `实际：${r.actual_start ? `${r.actual_start} ~ ${r.actual_end || '进行中'}` : '—'}`,
            `完成：${r.done_qty ?? 0} / ${r.plan_qty ?? 0} ${r.qty_unit}（${pct}%）`,
            `状态：${r.status}${r.owner ? '　负责人：' + r.owner : ''}`,
          ].join('<br/>')
        },
      },
      xAxis: {
        type: 'time',
        position: 'top',
        min: minTs - pad,
        max: maxTs + pad,
        axisLine: { lineStyle: { color: '#e8e8e8' } },
        axisTick: { show: false },
        axisLabel: {
          formatter: (v: number) => dayjs(v).format('MM-DD'),
          fontSize: 11,
          color: '#8c8c8c',
          hideOverlap: true,
        },
        splitLine: { show: true, lineStyle: { color: '#f0f0f0', type: 'dashed' } },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: yData,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#e8e8e8' } },
        axisLabel: { width: 148, overflow: 'truncate', fontSize: 12, color: '#595959' },
        splitLine: { show: true, lineStyle: { color: '#f5f5f5' } },
      },
      dataZoom: [
        { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
        {
          type: 'slider',
          xAxisIndex: 0,
          filterMode: 'none',
          height: 18,
          bottom: 12,
          borderColor: 'transparent',
          backgroundColor: '#fafafa',
          fillerColor: 'rgba(22,119,255,0.10)',
          handleStyle: { color: '#1677ff' },
          labelFormatter: (v: number) => dayjs(v).format('MM-DD'),
        },
      ],
      series: [
        {
          name: '工序',
          type: 'custom',
          renderItem,
          clip: false,
          z: 3,
          data: barData,
          markLine: {
            symbol: 'none',
            silent: true,
            lineStyle: { color: '#ff4d4f', type: 'dashed', width: 1 },
            label: { formatter: '今天', color: '#ff4d4f', fontSize: 11, position: 'end' },
            data: [{ xAxis: todayTs }],
          },
        },
        ...(hasMs
          ? [{
              name: '里程碑',
              type: 'scatter',
              symbol: 'diamond',
              symbolSize: 13,
              z: 4,
              data: milestoneData,
            }]
          : []),
      ],
    }

    return { option, height, barData }
  }, [processes, milestones])

  const onEvents = useMemo(() => ({
    click: (p: any) => {
      if (!onBarClick || p?.seriesName !== '工序') return
      const raw: ProcessRow | undefined = p?.data?.raw || built.barData[p?.dataIndex]?.raw
      if (raw && raw.id) onBarClick(raw)
    },
  }), [built, onBarClick])

  if (!processes.length) {
    return <Empty description="暂无工序，点右上角「新增工序」后再查看甘特视图" style={{ padding: '70px 0' }} />
  }

  const exportPng = () => {
    const inst: any = ref.current?.getEchartsInstance?.()
    if (!inst) return
    const url = inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' })
    const a = document.createElement('a')
    a.href = url
    a.download = `工序甘特图-${dayjs().format('YYYYMMDD-HHmm')}.png`
    a.click()
  }

  return (
    <div>
      <Space size={18} style={{ marginBottom: 6, fontSize: 12, color: '#8c8c8c' }}>
        <span>
          <span style={{ display: 'inline-block', width: 14, height: 8, borderRadius: 2, background: 'rgba(22,119,255,0.12)', border: '1px solid #91caff', marginRight: 6, verticalAlign: 'middle' }} />
          计划区间
        </span>
        <span>
          <span style={{ display: 'inline-block', width: 14, height: 8, borderRadius: 4, background: '#1677ff', marginRight: 6, verticalAlign: 'middle' }} />
          实际进度
        </span>
        <span>
          <span style={{ display: 'inline-block', width: 10, height: 10, background: '#722ed1', transform: 'rotate(45deg)', marginRight: 6, verticalAlign: 'middle' }} />
          里程碑
        </span>
        <span>
          <span style={{ display: 'inline-block', width: 0, height: 12, borderLeft: '1px dashed #ff4d4f', marginRight: 6, verticalAlign: 'middle' }} />
          今天
        </span>
        <Button size="small" type="text" icon={<DownloadOutlined />} onClick={exportPng} style={{ color: '#1677ff' }}>
          导出图片
        </Button>
        {onBarClick && <span style={{ color: '#bfbfbf' }}>点击条形可直接编辑该工序</span>}
      </Space>
      <ReactECharts
        ref={ref as any}
        option={built.option}
        style={{ height: built.height, width: '100%' }}
        onEvents={onEvents}
        notMerge
        lazyUpdate
      />
    </div>
  )
}
