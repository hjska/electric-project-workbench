import { useEffect, useState } from 'react'
import { Card, Col, Row, Statistic, Typography, Empty, Table, Tag, Spin, Progress } from 'antd'
import ReactECharts from 'echarts-for-react'
import { useNavigate } from 'react-router-dom'
import type { DashboardData } from '../types'
import { STATUS_COLOR } from '../utils/dict'

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const nav = useNavigate()

  const load = async () => {
    setLoading(true)
    try {
      const d = await window.api.stats.dashboard()
      setData(d)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><Spin size="large" /></div>
  if (!data) return <Empty description="暂无数据" style={{ marginTop: 100 }} />

  const { cards, projectProgress, arrivalDist, trend, openIssues } = data

  return (
    <div className="page-container">
      <Row gutter={16}>
        <Col span={6}>
          <Card hoverable onClick={() => nav('/projects')}>
            <Statistic title="在建项目" value={cards.buildingCount} suffix="个" valueStyle={{ color: '#1668dc' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card hoverable onClick={() => nav('/projects')}>
            <Statistic title="逾期工序" value={cards.overdueProcess} suffix="项" valueStyle={{ color: cards.overdueProcess > 0 ? '#d4380d' : undefined }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card hoverable onClick={() => nav('/projects')}>
            <Statistic title="未闭环问题" value={cards.openIssue} suffix="条" valueStyle={{ color: cards.openIssue > 0 ? '#fa8c16' : undefined }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card hoverable onClick={() => nav('/materials')}>
            <Statistic title="本月到货设备" value={cards.monthArrival} suffix="台" valueStyle={{ color: '#389e0d' }} />
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={14}>
          <Card title="各项目进度" size="small" styles={{ body: { height: 300 } }}>
            {projectProgress.length ? (
              <ReactECharts
                style={{ height: 280 }}
                option={{
                  grid: { left: 130, right: 50, top: 20, bottom: 20 },
                  xAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
                  yAxis: {
                    type: 'category',
                    data: projectProgress.map((p) => p.name).reverse(),
                    axisLabel: { fontSize: 12, width: 120, overflow: 'truncate' },
                  },
                  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                  series: [
                    {
                      type: 'bar',
                      data: projectProgress.map((p) => p.progress).reverse(),
                      barWidth: 16,
                      itemStyle: { color: '#1668dc', borderRadius: [0, 4, 4, 0] },
                      label: { show: true, position: 'right', formatter: '{c}%', fontSize: 11 },
                    },
                  ],
                }}
              />
            ) : (
              <Empty description="暂无在建项目" style={{ marginTop: 70 }} />
            )}
          </Card>
        </Col>
        <Col span={10}>
          <Card title="设备到货状态分布" size="small" styles={{ body: { height: 300 } }}>
            {arrivalDist.length ? (
              <ReactECharts
                style={{ height: 280 }}
                option={{
                  tooltip: { trigger: 'item' },
                  legend: { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 12 } },
                  series: [
                    {
                      type: 'pie',
                      radius: ['42%', '68%'],
                      center: ['50%', '45%'],
                      data: arrivalDist.map((d) => ({ name: d.name, value: d.value })),
                      label: { formatter: '{b}\n{c}', fontSize: 11 },
                      color: ['#bfbfbf', '#fa8c16', '#1668dc'],
                    },
                  ],
                }}
              />
            ) : (
              <Empty description="暂无设备数据" style={{ marginTop: 70 }} />
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={14}>
          <Card title="近 30 天日报趋势" size="small" styles={{ body: { height: 260 } }}>
            <ReactECharts
              style={{ height: 240 }}
              option={{
                grid: { left: 40, right: 20, top: 20, bottom: 30 },
                xAxis: { type: 'category', data: trend.map((t) => t.date.slice(5)), axisLabel: { fontSize: 11 } },
                yAxis: { type: 'value' },
                tooltip: { trigger: 'axis' },
                series: [
                  {
                    type: 'line',
                    smooth: true,
                    data: trend.map((t) => t.count),
                    areaStyle: { color: 'rgba(22,104,220,0.12)' },
                    itemStyle: { color: '#1668dc' },
                    name: '日报条数',
                  },
                ],
              }}
            />
          </Card>
        </Col>
        <Col span={10}>
          <Card title="待办问题（按紧急程度）" size="small" styles={{ body: { height: 260, overflow: 'auto' } }}>
            {openIssues.length ? (
              openIssues.map((it: any) => (
                <div key={it.id} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <Typography.Text ellipsis style={{ fontSize: 13, flex: 1 }}>{it.description}</Typography.Text>
                    <Tag color={STATUS_COLOR[it.severity]} style={{ marginInlineEnd: 0 }}>{it.severity}</Tag>
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {it.project_name || '—'} ｜ 要求闭环：{it.due_date || '未定'}
                  </Typography.Text>
                </div>
              ))
            ) : (
              <Empty description="暂无待办问题" style={{ marginTop: 60 }} />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  )
}
