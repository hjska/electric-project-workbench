import { useEffect, useState } from 'react'
import {
  Table, Button, Space, Tag, Modal, Form, Input, Select, DatePicker, message,
  Popconfirm, Row, Col, Typography,
} from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { MilestoneRow, ProcessRow } from '../../types'
import { MILESTONE_STATUS, STATUS_COLOR } from '../../utils/dict'

export default function MilestoneTab({ projectId }: { projectId: number }) {
  const [list, setList] = useState<MilestoneRow[]>([])
  const [processes, setProcesses] = useState<ProcessRow[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<MilestoneRow | null>(null)
  const [form] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try {
      setList(await window.api.milestone.list(projectId))
      setProcesses(await window.api.process.list(projectId))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [projectId])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ status: '未开始', plan_date: dayjs() })
    setOpen(true)
  }

  const openEdit = async (row: MilestoneRow) => {
    setEditing(row)
    form.setFieldsValue({
      ...row,
      plan_date: row.plan_date ? dayjs(row.plan_date) : null,
      actual_date: row.actual_date ? dayjs(row.actual_date) : null,
    })
    setOpen(true)
  }

  const submit = async () => {
    try {
      const v = await form.validateFields()
      const payload: any = {
        project_id: projectId,
        name: v.name,
        plan_date: v.plan_date.format('YYYY-MM-DD'),
        actual_date: v.actual_date?.format('YYYY-MM-DD') || null,
        status: v.status,
        description: v.description,
        process_ids: v.process_ids || [],
      }
      if (editing?.id) {
        await window.api.milestone.update(editing.id, payload)
        message.success('已更新')
      } else {
        await window.api.milestone.create(payload)
        message.success('已新增')
      }
      setOpen(false)
      load()
    } catch (e: any) {
      if (e?.errorFields) return
      message.error(e.message || '保存失败')
    }
  }

  const remove = async (row: MilestoneRow) => {
    await window.api.milestone.remove(row.id!)
    message.success('已删除')
    load()
  }

  const columns = [
    { title: '里程碑名称', dataIndex: 'name', width: 180, ellipsis: true },
    { title: '计划日期', dataIndex: 'plan_date', width: 120 },
    {
      title: '实际日期', dataIndex: 'actual_date', width: 120,
      render: (v: string | null, r: MilestoneRow) => (v ? <span>{v} {v > r.plan_date ? <Tag color="warning">延期</Tag> : null}</span> : '—'),
    },
    { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <Tag color={STATUS_COLOR[v]}>{v}</Tag> },
    { title: '关联工序数', dataIndex: 'process_count', width: 100, render: (v: number) => v || 0 },
    { title: '说明', dataIndex: 'description', ellipsis: true },
    {
      title: '操作', width: 120, fixed: 'right' as const,
      render: (_: any, r: MilestoneRow) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确认删除该里程碑？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => remove(r)}>
            <Button type="link" size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Row justify="space-between" style={{ marginBottom: 12 }}>
        <Col><Typography.Text type="secondary" style={{ fontSize: 12 }}>共 {list.length} 个里程碑</Typography.Text></Col>
        <Col><Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增里程碑</Button></Col>
      </Row>

      <Table
        rowKey="id" size="small" loading={loading} columns={columns} dataSource={list}
        scroll={{ x: 900 }}
        rowClassName={(r) => (r.isOverdue ? 'row-overdue' : '')}
        pagination={false}
        locale={{ emptyText: <div style={{ padding: 40 }}><Typography.Text type="secondary">暂无里程碑，如「送电验收」可在此登记</Typography.Text></div> }}
      />

      <Modal title={editing ? '编辑里程碑' : '新增里程碑'} open={open} onOk={submit} onCancel={() => setOpen(false)} width={620} okText="保存" cancelText="取消" destroyOnClose>
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item name="name" label="里程碑名称" rules={[{ required: true, message: '请输入名称' }]}>
                <Input placeholder="如 送电验收" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="plan_date" label="计划日期" rules={[{ required: true, message: '请选择' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="actual_date" label="实际日期">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="status" label="状态" rules={[{ required: true }]}>
                <Select options={MILESTONE_STATUS.map((s) => ({ label: s, value: s }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="process_ids" label="关联工序">
                <Select
                  mode="multiple" allowClear placeholder="可多选"
                  options={processes.map((p) => ({ label: p.name, value: p.id }))}
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="description" label="说明"><Input.TextArea rows={2} /></Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  )
}
