import { useEffect, useState } from 'react'
import {
  Card, Button, Row, Col, Typography, Table, Space, message, Modal, Form,
  InputNumber, TimePicker, Switch, Input, Tag, Popconfirm, Statistic, Spin,
} from 'antd'
import { DatabaseOutlined, CloudDownloadOutlined, ReloadOutlined, DeleteOutlined, FolderOpenOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

export default function BackupPage() {
  const [info, setInfo] = useState<any>(null)
  const [settings, setSettings] = useState<any>(null)
  const [backups, setBackups] = useState<any[]>([])
  const [dir, setDir] = useState('')
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try {
      const [appInfo, s, b] = await Promise.all([
        window.api.app.getInfo(),
        window.api.backup.settings(),
        window.api.backup.listBackups(),
      ])
      setInfo(appInfo)
      setSettings(s)
      setBackups(b.items)
      setDir(b.dir)
      form.setFieldsValue({ autoEnabled: s.autoEnabled, time: dayjs(s.time, 'HH:mm'), keep: s.keep })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const saveSettings = async () => {
    const v = await form.validateFields()
    const s = await window.api.backup.saveSettings({
      autoEnabled: v.autoEnabled,
      time: v.time.format('HH:mm'),
      keep: v.keep,
    })
    setSettings(s)
    message.success('备份设置已保存')
  }

  const runNow = async () => {
    const r = await window.api.backup.runNow()
    if (r.canceled) return
    message.success('已备份到：' + r.path)
    load()
  }

  const restore = async () => {
    const r = await window.api.backup.restore()
    if (r.canceled) return
    message.success('恢复完成，建议重启应用')
    load()
  }

  const removeBackup = async (name: string) => {
    await window.api.backup.deleteBackup(`${dir}\\${name}`)
    message.success('已删除')
    load()
  }

  const humanSize = (b: number) => (b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(2)} MB`)

  return (
    <div className="page-container">
      <Row gutter={16}>
        <Col span={14}>
          <Card title="备份设置" size="small">
            <Form form={form} layout="horizontal" labelCol={{ span: 5 }} wrapperCol={{ span: 16 }}>
              <Form.Item name="autoEnabled" label="每日自动备份" valuePropName="checked">
                <Switch checkedChildren="开" unCheckedChildren="关" />
              </Form.Item>
              <Form.Item name="time" label="备份时间">
                <TimePicker format="HH:mm" minuteStep={5} style={{ width: 140 }} />
              </Form.Item>
              <Form.Item name="keep" label="保留份数">
                <InputNumber min={1} max={365} style={{ width: 140 }} />
              </Form.Item>
              <Form.Item label=" ">
                <Space>
                  <Button type="primary" onClick={saveSettings}>保存设置</Button>
                  <Button icon={<DatabaseOutlined />} onClick={runNow}>立即备份（选择位置）</Button>
                  <Button danger icon={<CloudDownloadOutlined />} onClick={restore}>从备份恢复</Button>
                </Space>
              </Form.Item>
            </Form>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              自动备份保存在本机 <code>{dir}</code>，超出保留份数时自动清理最旧的备份。
            </Typography.Text>
          </Card>

          <Card title="当前数据位置" size="small" style={{ marginTop: 16 }}>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <div><Typography.Text type="secondary">数据库：</Typography.Text><Typography.Text code copyable>{info?.dbPath || '—'}</Typography.Text></div>
              <div><Typography.Text type="secondary">附件目录：</Typography.Text><Typography.Text code copyable>{info?.attachmentsDir || '—'}</Typography.Text></div>
              <div><Typography.Text type="secondary">应用目录：</Typography.Text><Typography.Text code copyable>{info?.root || '—'}</Typography.Text></div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                迁移到新电脑：拷贝整个应用目录（含 data 文件夹）即可，无需重新录入。
              </Typography.Text>
            </Space>
          </Card>
        </Col>

        <Col span={10}>
          <Card
            title="历史备份" size="small"
            extra={<Button size="small" icon={<ReloadOutlined />} onClick={load}>刷新</Button>}
          >
            {loading ? <Spin /> : (
              <Table
                rowKey="name" size="small" pagination={{ pageSize: 8 }} dataSource={backups}
                columns={[
                  { title: '备份名称', dataIndex: 'name', ellipsis: true, render: (v: string) => <Typography.Text style={{ fontSize: 12 }}>{v}</Typography.Text> },
                  { title: '大小', dataIndex: 'size', width: 80, render: humanSize },
                  { title: '时间', dataIndex: 'mtime', width: 130, render: (v: string) => dayjs(v).format('MM-DD HH:mm') },
                  {
                    title: '', width: 80,
                    render: (_: any, r: any) => (
                      <Space size={2}>
                        <a onClick={() => window.api.shell.showItemInFolder(`${dir}\\${r.name}\\app.db`)}><FolderOpenOutlined /></a>
                        <Popconfirm title="删除该备份？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => removeBackup(r.name)}>
                          <a><DeleteOutlined style={{ color: '#d4380d' }} /></a>
                        </Popconfirm>
                      </Space>
                    ),
                  },
                ]}
                locale={{ emptyText: '暂无备份' }}
              />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  )
}
