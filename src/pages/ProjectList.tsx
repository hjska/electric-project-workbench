import { useEffect, useState } from 'react'
import {
  Table, Button, Input, Select, Space, Tag, Modal, Form, DatePicker, InputNumber,
  message, notification, Popconfirm, Progress, Card, Typography, Row, Col,
} from 'antd'
import { PlusOutlined, SearchOutlined, FolderOpenOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import type { ProjectRow } from '../types'
import { PROJECT_STATUS, STATUS_COLOR } from '../utils/dict'

export default function ProjectList() {
  const nav = useNavigate()
  const [list, setList] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(false)
  const [kw, setKw] = useState('')
  const [status, setStatus] = useState<string | undefined>()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ProjectRow | null>(null)
  const [form] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try {
      const rows = await window.api.project.list({ keyword: kw || undefined, status })
      setList(rows)
    } catch (e: any) {
      message.error(e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [status])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ status: '未开工' })
    setOpen(true)
  }

  const openEdit = async (row: ProjectRow) => {
    const full = await window.api.project.get(row.id!)
    setEditing(full)
    form.setFieldsValue({
      ...full,
      start_date: full.start_date ? dayjs(full.start_date) : null,
      plan_end_date: full.plan_end_date ? dayjs(full.plan_end_date) : null,
      actual_end_date: full.actual_end_date ? dayjs(full.actual_end_date) : null,
    })
    setOpen(true)
  }

  const submit = async () => {
    try {
      const v = await form.validateFields()
      const payload: any = {
        ...v,
        start_date: v.start_date?.format('YYYY-MM-DD'),
        plan_end_date: v.plan_end_date?.format('YYYY-MM-DD'),
        actual_end_date: v.actual_end_date?.format('YYYY-MM-DD') || null,
      }
      if (editing?.id) {
        await window.api.project.update(editing.id, payload)
        message.success('项目已更新')
      } else {
        const created: any = await window.api.project.create(payload)
        if (created.folderWarning) {
          notification.warning({
            message: '项目已创建，但资料文件夹未生成',
            description: `原因：${created.folderWarning}。可在「设置」里调整资料根目录后，用「为已有项目补建文件夹」重试。`,
            duration: 10,
          })
        } else if (created.folder_path) {
          notification.success({
            message: '项目已创建',
            description: (
              <div>
                <div>已自动生成资料文件夹：</div>
                <Typography.Text code style={{ fontSize: 12, wordBreak: 'break-all' }}>{created.folder_path}</Typography.Text>
              </div>
            ),
            btn: (
              <Button size="small" type="primary" onClick={() => created.id && openFolder(created)}>
                打开文件夹
              </Button>
            ),
            duration: 9,
          })
        } else {
          message.success('项目已创建')
        }
      }
      setOpen(false)
      load()
    } catch (e: any) {
      if (e?.errorFields) return
      message.error(e.message || '保存失败')
    }
  }

  const openFolder = async (row: ProjectRow) => {
    try {
      const r = await window.api.folder.open(row.id!)
      if (!r.ok) message.error('打开失败：' + r.message)
    } catch (e: any) {
      message.error(e.message || '打开文件夹失败')
    }
  }

  const remove = async (row: ProjectRow) => {
    try {
      const res: any = await window.api.project.remove(row.id!)
      const c = res.cascade
      message.success(
        `已删除（设备${c.equipment} 工序${c.process} 里程碑${c.milestone} 问题${c.issue} 附件${c.attachment}）` +
        (res.folderKept ? '；资料文件夹已保留在磁盘上' : ''),
        6,
      )
      load()
    } catch (e: any) {
      message.error(e.message || '删除失败')
    }
  }

  const columns = [
    { title: '编号', dataIndex: 'code', width: 130, fixed: 'left' as const },
    {
      title: '项目名称',
      dataIndex: 'name',
      ellipsis: true,
      render: (v: string, r: ProjectRow) => (
        <a onClick={() => nav(`/projects/${r.id}`)}>{v}</a>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: string) => <Tag color={STATUS_COLOR[v]}>{v}</Tag>,
    },
    { title: '项目经理', dataIndex: 'manager', width: 100 },
    { title: '开工', dataIndex: 'start_date', width: 105 },
    {
      title: '计划竣工',
      dataIndex: 'plan_end_date',
      width: 115,
      render: (v: string) => {
        const overdue = v && v < dayjs().format('YYYY-MM-DD')
        return <span className={overdue ? 'text-danger' : ''}>{v}{overdue ? ' ⚠' : ''}</span>
      },
    },
    {
      title: '进度',
      dataIndex: 'progress',
      width: 130,
      render: (v: number) => <Progress percent={v} size="small" />,
    },
    {
      title: '到货率',
      dataIndex: 'arrival_rate',
      width: 80,
      render: (v: number) => `${v}%`,
    },
    {
      title: '操作',
      width: 225,
      fixed: 'right' as const,
      render: (_: any, r: ProjectRow) => (
        <Space size={2}>
          <Button type="link" size="small" onClick={() => nav(`/projects/${r.id}`)}>详情</Button>
          <Button type="link" size="small" icon={<FolderOpenOutlined />} onClick={() => openFolder(r)}>资料</Button>
          <Button type="link" size="small" onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm
            title="确定删除该项目？"
            description="项目下的设备、工序、问题、附件记录将一并删除。资料文件夹及其中的文件会保留在磁盘上。"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => remove(r)}
          >
            <Button type="link" size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div className="page-container">
      <Card
        size="small"
        title="项目台账"
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建项目</Button>}
        styles={{ body: { padding: 12 } }}
      >
        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col>
            <Input
              placeholder="搜索编号 / 名称"
              prefix={<SearchOutlined />}
              allowClear
              style={{ width: 220 }}
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              onPressEnter={load}
            />
          </Col>
          <Col>
            <Select
              placeholder="全部状态"
              allowClear
              style={{ width: 130 }}
              value={status}
              onChange={setStatus}
              options={PROJECT_STATUS.map((s) => ({ label: s, value: s }))}
            />
          </Col>
          <Col>
            <Button onClick={load}>查询</Button>
          </Col>
        </Row>
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={list}
          scroll={{ x: 1200 }}
          pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (t) => `共 ${t} 个项目` }}
          locale={{ emptyText: <div style={{ padding: 40 }}><Typography.Text type="secondary">还没有项目，点右上角「新建项目」开始</Typography.Text></div> }}
        />
      </Card>

      <Modal
        title={editing ? '编辑项目' : '新建项目'}
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        width={720}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="code" label="项目编号" rules={[{ required: true, message: '请输入项目编号' }]}>
                <Input placeholder="如 PRJ-2026-001" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
                <Input placeholder="如 XX厂 3#配电室改造" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="address" label="项目地址">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="owner_unit" label="建设单位">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="build_unit" label="施工单位">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="supervise_unit" label="监理单位">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="manager" label="项目经理" rules={[{ required: true, message: '请输入项目经理' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="phone" label="联系电话">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="contract_amount" label="合同金额（元）">
                <InputNumber style={{ width: '100%' }} min={0} precision={2} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="status" label="项目状态" rules={[{ required: true }]}>
                <Select options={PROJECT_STATUS.map((s) => ({ label: s, value: s }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="start_date" label="开工日期" rules={[{ required: true, message: '请选择开工日期' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="plan_end_date"
                label="计划竣工日期"
                rules={[
                  { required: true, message: '请选择计划竣工日期' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      const s = getFieldValue('start_date')
                      if (!value || !s || !value.isBefore(s, 'day')) return Promise.resolve()
                      return Promise.reject(new Error('不得早于开工日期'))
                    },
                  }),
                ]}
              >
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="actual_end_date" label="实际竣工日期">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="remark" label="备注">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  )
}
