import { useEffect, useState } from 'react'
import {
  Table, Button, Space, Tag, Modal, Form, Input, Select, DatePicker, message,
  Popconfirm, Row, Col, Typography,
} from 'antd'
import { PlusOutlined, ExportOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { IssueRow, ProcessRow } from '../../types'
import { SEVERITY, ISSUE_STATUS, STATUS_COLOR } from '../../utils/dict'

export default function IssueTab({ projectId }: { projectId: number }) {
  const [list, setList] = useState<IssueRow[]>([])
  const [processes, setProcesses] = useState<ProcessRow[]>([])
  const [loading, setLoading] = useState(false)
  const [quick, setQuick] = useState<string | undefined>()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<IssueRow | null>(null)
  const [form] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try {
      setList(await window.api.issue.list({ projectId, quick }))
      setProcesses(await window.api.process.list(projectId))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [projectId, quick])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ severity: '一般', status: '待处理', report_date: dayjs() })
    setOpen(true)
  }

  const openEdit = (row: IssueRow) => {
    setEditing(row)
    form.setFieldsValue({
      ...row,
      report_date: row.report_date ? dayjs(row.report_date) : null,
      due_date: row.due_date ? dayjs(row.due_date) : null,
      close_date: row.close_date ? dayjs(row.close_date) : null,
    })
    setOpen(true)
  }

  const submit = async () => {
    try {
      const v = await form.validateFields()
      const payload: any = {
        project_id: projectId,
        process_id: v.process_id || null,
        description: v.description,
        severity: v.severity,
        reporter: v.reporter,
        report_date: v.report_date.format('YYYY-MM-DD'),
        owner: v.owner,
        due_date: v.due_date?.format('YYYY-MM-DD') || null,
        status: v.status,
        solution: v.solution || null,
        close_date: v.close_date?.format('YYYY-MM-DD') || null,
      }
      if (editing?.id) {
        await window.api.issue.update(editing.id, payload)
        message.success('已更新')
      } else {
        await window.api.issue.create(payload)
        message.success('已记录')
      }
      setOpen(false)
      load()
    } catch (e: any) {
      if (e?.errorFields) return
      message.error(e.message || '保存失败')
    }
  }

  const remove = async (row: IssueRow) => {
    await window.api.issue.remove(row.id!)
    message.success('已删除')
    load()
  }

  const exportExcel = async () => {
    const r = await window.api.report_export.issue(projectId)
    if (r.canceled) return
    message.success('已导出：' + r.path)
  }

  const columns = [
    { title: '问题描述', dataIndex: 'description', width: 260, ellipsis: true },
    { title: '等级', dataIndex: 'severity', width: 80, render: (v: string) => <Tag color={STATUS_COLOR[v]}>{v}</Tag> },
    { title: '关联工序', dataIndex: 'process_name', width: 120, ellipsis: true },
    { title: '提出人', dataIndex: 'reporter', width: 90 },
    { title: '提出日期', dataIndex: 'report_date', width: 110 },
    { title: '责任人', dataIndex: 'owner', width: 90 },
    {
      title: '要求闭环', dataIndex: 'due_date', width: 120,
      render: (v: string, r: IssueRow) => (v ? <span className={r.isOverdue ? 'text-danger' : ''}>{v}{r.isOverdue ? ' 逾期' : ''}</span> : '—'),
    },
    { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag color={STATUS_COLOR[v]}>{v}</Tag> },
    {
      title: '操作', width: 120, fixed: 'right' as const,
      render: (_: any, r: IssueRow) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => openEdit(r)}>处理</Button>
          <Popconfirm title="确认删除该问题记录？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => remove(r)}>
            <Button type="link" size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Row justify="space-between" style={{ marginBottom: 12 }}>
        <Col>
          <Space>
            <Select
              placeholder="状态筛选" allowClear style={{ width: 160 }} value={quick} onChange={setQuick}
              options={[
                { label: '全部', value: undefined },
                { label: '待处理', value: undefined },
                { label: '仅看逾期未闭环', value: 'overdue' },
              ].filter((o) => o.value !== undefined || o.label === '全部')}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>共 {list.length} 条问题</Typography.Text>
          </Space>
        </Col>
        <Col>
          <Space>
            <Button icon={<ExportOutlined />} onClick={exportExcel}>导出问题台账</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>记录问题</Button>
          </Space>
        </Col>
      </Row>

      <Table
        rowKey="id" size="small" loading={loading} columns={columns} dataSource={list}
        scroll={{ x: 1200 }}
        rowClassName={(r) => (r.isOverdue ? 'row-overdue' : '')}
        pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (t) => `共 ${t} 条` }}
        expandable={{
          expandedRowRender: (r) => (
            <div style={{ padding: '4px 8px' }}>
              <Typography.Paragraph style={{ marginBottom: 4 }}>
                <Typography.Text strong>处理措施：</Typography.Text>{r.solution || '暂无'}
              </Typography.Paragraph>
              <Typography.Text type="secondary">闭环日期：{r.close_date || '—'}</Typography.Text>
            </div>
          ),
        }}
        locale={{ emptyText: <div style={{ padding: 40 }}><Typography.Text type="secondary">暂无问题记录</Typography.Text></div> }}
      />

      <Modal title={editing ? '处理问题' : '记录问题'} open={open} onOk={submit} onCancel={() => setOpen(false)} width={680} okText="保存" cancelText="取消" destroyOnClose>
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item name="description" label="问题描述" rules={[{ required: true, message: '请输入问题描述' }]}>
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="severity" label="严重等级" rules={[{ required: true }]}>
                <Select options={SEVERITY.map((s) => ({ label: s, value: s }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="process_id" label="关联工序">
                <Select allowClear placeholder="可关联" options={processes.map((p) => ({ label: p.name, value: p.id }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="reporter" label="提出人"><Input /></Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="report_date" label="提出日期" rules={[{ required: true }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="owner" label="责任人"><Input /></Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="due_date" label="要求闭环日期"><DatePicker style={{ width: '100%' }} /></Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="status" label="状态" rules={[{ required: true }]}>
                <Select options={ISSUE_STATUS.map((s) => ({ label: s, value: s }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="close_date" label="闭环日期">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="solution" label="处理措施">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  )
}
