import { useEffect, useState } from 'react'
import {
  Table, Button, Space, Tag, Modal, Form, Input, Select, DatePicker, InputNumber,
  message, Popconfirm, Row, Col, Progress, Typography, Segmented,
} from 'antd'
import { PlusOutlined, ExportOutlined, EditOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { ProcessRow, ReportRow, MilestoneRow } from '../../types'
import { PROCESS_STATUS, UNITS, WEATHER, STATUS_COLOR } from '../../utils/dict'
import GanttChart from '../../components/GanttChart'

export default function ProcessTab({ projectId }: { projectId: number }) {
  const [list, setList] = useState<ProcessRow[]>([])
  const [milestones, setMilestones] = useState<MilestoneRow[]>([])
  const [view, setView] = useState<'list' | 'gantt'>('list')
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ProcessRow | null>(null)
  const [form] = Form.useForm()

  // 日报弹窗
  const [reportOpen, setReportOpen] = useState(false)
  const [reportProcess, setReportProcess] = useState<ProcessRow | null>(null)
  const [reportForm] = Form.useForm()
  const [continuous, setContinuous] = useState(false)
  const [todayReports, setTodayReports] = useState<ReportRow[]>([])

  const load = async () => {
    setLoading(true)
    try {
      setList(await window.api.process.list(projectId))
      setMilestones(await window.api.milestone.list(projectId))
      setTodayReports(await window.api.report.list({ projectId, from: dayjs().format('YYYY-MM-DD') }))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [projectId])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({
      qty_unit: '项', plan_qty: 0, weight: 1, status: '未开始',
      plan_start: dayjs(), plan_end: dayjs().add(7, 'day'),
    })
    setOpen(true)
  }

  const openEdit = (row: ProcessRow) => {
    setEditing(row)
    form.setFieldsValue({
      ...row,
      plan_start: row.plan_start ? dayjs(row.plan_start) : null,
      plan_end: row.plan_end ? dayjs(row.plan_end) : null,
    })
    setOpen(true)
  }

  const submit = async () => {
    try {
      const v = await form.validateFields()
      const payload: any = {
        ...v,
        project_id: projectId,
        plan_start: v.plan_start?.format('YYYY-MM-DD'),
        plan_end: v.plan_end?.format('YYYY-MM-DD'),
      }
      if (editing?.id) {
        await window.api.process.update(editing.id, payload)
        message.success('已更新')
      } else {
        await window.api.process.create(payload)
        message.success('已新增')
      }
      setOpen(false)
      load()
    } catch (e: any) {
      if (e?.errorFields) return
      message.error(e.message || '保存失败')
    }
  }

  const remove = async (row: ProcessRow) => {
    await window.api.process.remove(row.id!)
    message.success('已删除')
    load()
  }

  const openReport = (row: ProcessRow) => {
    setReportProcess(row)
    reportForm.resetFields()
    reportForm.setFieldsValue({
      report_date: dayjs(),
      unit: row.qty_unit,
      weather: '晴',
      worker_count: 0,
    })
    setReportOpen(true)
  }

  const submitReport = async (overwrite = false) => {
    try {
      const v = await reportForm.validateFields()
      const payload = {
        project_id: projectId,
        process_id: reportProcess!.id!,
        report_date: v.report_date.format('YYYY-MM-DD'),
        day_qty: v.day_qty,
        unit: v.unit,
        weather: v.weather,
        worker_count: v.worker_count,
        recorder: v.recorder,
        site_note: v.site_note,
      }
      const res = await window.api.report.create(payload, overwrite)
      if (res?.error) {
        if (res.code === 'DUPLICATE_REPORT') {
          Modal.confirm({
            title: '今日已有日报',
            content: '该工序今日已有日报记录，是否覆盖？',
            okText: '覆盖',
            cancelText: '取消',
            onOk: () => submitReport(true),
          })
          return
        }
        message.error(res.error)
        return
      }
      const p = res.process
      message.success(`已记录，工序完成率 ${Math.round(((reportProcess!.ratio ?? 0) * 100))}% → ${Math.round(((p?.ratio ?? 0) * 100))}%`)
      if (continuous) {
        reportForm.setFieldsValue({ day_qty: undefined, site_note: undefined })
        load()
      } else {
        setReportOpen(false)
        load()
      }
    } catch (e: any) {
      if (e?.errorFields) return
      message.error(e.message || '保存失败')
    }
  }

  const exportExcel = async () => {
    const r = await window.api.report_export.process(projectId)
    if (r.canceled) return
    message.success('已导出：' + r.path)
  }

  const today = dayjs().format('YYYY-MM-DD')
  const columns = [
    { title: '序号', dataIndex: 'seq_no', width: 60 },
    { title: '工序名称', dataIndex: 'name', width: 150, ellipsis: true },
    { title: '计划区间', width: 190, render: (_: any, r: ProcessRow) => `${r.plan_start} ~ ${r.plan_end}` },
    {
      title: '实际区间', width: 190,
      render: (_: any, r: ProcessRow) => (r.actual_start ? `${r.actual_start} ~ ${r.actual_end || '进行中'}` : '—'),
    },
    {
      title: '完成量/计划量', width: 130,
      render: (_: any, r: ProcessRow) => `${r.done_qty ?? 0} / ${r.plan_qty ?? 0} ${r.qty_unit}`,
    },
    {
      title: '完成率', width: 140,
      render: (_: any, r: ProcessRow) => {
        const pct = Math.round((r.ratio ?? 0) * 100)
        return <Progress percent={pct} size="small" status={pct >= 100 ? 'success' : 'active'} />
      },
    },
    { title: '权重', dataIndex: 'weight', width: 60 },
    { title: '负责人', dataIndex: 'owner', width: 90 },
    { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag color={STATUS_COLOR[v]}>{v}</Tag> },
    {
      title: '操作', width: 190, fixed: 'right' as const,
      render: (_: any, r: ProcessRow) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => openReport(r)}>记日报</Button>
          <Button type="link" size="small" onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确认删除该工序？关联日报将一并删除。" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => remove(r)}>
            <Button type="link" size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const isOverdue = (r: ProcessRow) => r.status !== '已完成' && r.status !== '已暂停' && r.plan_end < today

  return (
    <div>
      <Row justify="space-between" style={{ marginBottom: 12 }}>
        <Col>
          <Space size={12}>
            <Segmented
              value={view}
              onChange={(v) => setView(v as 'list' | 'gantt')}
              options={[{ label: '列表视图', value: 'list' }, { label: '甘特视图', value: 'gantt' }]}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              今日已有 {todayReports.length} 条日报 ｜ 共 {list.length} 道工序
            </Typography.Text>
          </Space>
        </Col>
        <Col>
          <Space>
            <Button icon={<ExportOutlined />} onClick={exportExcel}>导出进度表</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增工序</Button>
          </Space>
        </Col>
      </Row>

      {view === 'list' ? (
        <Table
          rowKey="id" size="small" loading={loading} columns={columns} dataSource={list}
          scroll={{ x: 1350 }}
          rowClassName={(r) => (isOverdue(r) ? 'row-overdue' : '')}
          pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (t) => `共 ${t} 道工序` }}
          expandable={{
            expandedRowRender: (r) => <ReportHistory processId={r.id!} />,
            rowExpandable: (r) => (r.report_count ?? 0) > 0,
          }}
          locale={{ emptyText: <div style={{ padding: 40 }}><Typography.Text type="secondary">暂无工序，点右上角「新增工序」开始拆解施工内容</Typography.Text></div> }}
        />
      ) : (
        <GanttChart processes={list} milestones={milestones} onBarClick={openEdit} />
      )}

      {/* 工序编辑弹窗 */}
      <Modal title={editing ? '编辑工序' : '新增工序'} open={open} onOk={submit} onCancel={() => setOpen(false)} width={680} okText="保存" cancelText="取消" destroyOnClose>
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Row gutter={16}>
            <Col span={16}>
              <Form.Item name="name" label="工序名称" rules={[{ required: true, message: '请输入工序名称' }]}>
                <Input placeholder="如 柜体就位" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="owner" label="负责人"><Input /></Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="plan_start" label="计划开始" rules={[{ required: true, message: '请选择' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="plan_end" label="计划结束" rules={[{ required: true, message: '请选择' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      const s = getFieldValue('plan_start')
                      if (!value || !s || !value.isBefore(s, 'day')) return Promise.resolve()
                      return Promise.reject(new Error('不得早于计划开始'))
                    },
                  }),
                ]}
              >
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="weight" label="进度权重" rules={[{ required: true }]}>
                <InputNumber style={{ width: '100%' }} min={0.1} step={0.5} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="plan_qty" label="计划总量" rules={[{ required: true, message: '按数量填，如 500' }]}>
                <InputNumber style={{ width: '100%' }} min={0} precision={2} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="qty_unit" label="计量单位" rules={[{ required: true }]}>
                <Select options={UNITS.map((u) => ({ label: u, value: u }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="status" label="状态" rules={[{ required: true }]}>
                <Select options={PROCESS_STATUS.map((s) => ({ label: s, value: s }))} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* 日报弹窗 */}
      <Modal
        title={`记录日报 — ${reportProcess?.name || ''}`}
        open={reportOpen}
        onOk={() => submitReport(false)}
        onCancel={() => setReportOpen(false)}
        width={560}
        okText="提交（Ctrl+Enter）"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={reportForm} layout="vertical" style={{ marginTop: 12 }} onFinish={() => submitReport(false)}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="report_date" label="日期" rules={[{ required: true }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="day_qty" label={`当日完成量`} rules={[{ required: true, message: '请输入' }]}>
                <InputNumber style={{ width: '100%' }} min={0.01} precision={2} autoFocus />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="unit" label="单位" rules={[{ required: true }]}>
                <Select options={UNITS.map((u) => ({ label: u, value: u }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="weather" label="天气">
                <Select allowClear options={WEATHER.map((w) => ({ label: w, value: w }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="worker_count" label="出勤人数">
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="recorder" label="记录人"><Input placeholder="默认可在设置中配置" /></Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="site_note" label="现场情况"><Input.TextArea rows={2} /></Form.Item>
            </Col>
          </Row>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            计划总量 {reportProcess?.plan_qty} {reportProcess?.qty_unit}，当前累计 {reportProcess?.done_qty}
          </Typography.Text>
          <div style={{ marginTop: 8 }}>
            <a onClick={() => setContinuous(!continuous)}>
              {continuous ? '✓ 连续录入模式（提交后不关闭）' : '连续录入模式（提交后不关闭）'}
            </a>
          </div>
        </Form>
      </Modal>
    </div>
  )
}

/** 某工序的日报历史 */
function ReportHistory({ processId }: { processId: number }) {
  const [rows, setRows] = useState<ReportRow[]>([])
  useEffect(() => {
    window.api.report.list({ processId }).then(setRows)
  }, [processId])

  return (
    <Table
      rowKey="id" size="small" pagination={false}
      dataSource={rows}
      columns={[
        { title: '日期', dataIndex: 'report_date', width: 110 },
        { title: '当日完成', dataIndex: 'day_qty', width: 100 },
        { title: '累计', dataIndex: 'cum_qty', width: 100 },
        { title: '单位', dataIndex: 'unit', width: 70 },
        { title: '天气', dataIndex: 'weather', width: 70 },
        { title: '出勤', dataIndex: 'worker_count', width: 70 },
        { title: '记录人', dataIndex: 'recorder', width: 90 },
        { title: '现场情况', dataIndex: 'site_note', ellipsis: true },
      ]}
    />
  )
}
