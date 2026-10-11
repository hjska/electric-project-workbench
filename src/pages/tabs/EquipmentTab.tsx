import { useEffect, useState } from 'react'
import {
  Table, Button, Space, Tag, Modal, Form, Input, Select, DatePicker, InputNumber,
  message, Popconfirm, Row, Col, Upload, Typography, Alert,
} from 'antd'
import { PlusOutlined, ImportOutlined, ExportOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import * as XLSX from 'xlsx'
import type { EquipmentRow } from '../../types'
import { ARRIVAL_STATUS, ACCEPT_STATUS, UNITS, STATUS_COLOR } from '../../utils/dict'

export default function EquipmentTab({ projectId }: { projectId: number }) {
  const [list, setList] = useState<EquipmentRow[]>([])
  const [loading, setLoading] = useState(false)
  const [quick, setQuick] = useState<string | undefined>()
  const [kw, setKw] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<EquipmentRow | null>(null)
  const [form] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try {
      setList(await window.api.equipment.list({ projectId, quick, keyword: kw || undefined }))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [quick, projectId])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ unit: '台', quantity: 1, arrival_status: '未到货', accept_status: '未验收', unit_price: 0 })
    setOpen(true)
  }

  const openEdit = (row: EquipmentRow) => {
    setEditing(row)
    form.setFieldsValue({
      ...row,
      contract_arrival_date: row.contract_arrival_date ? dayjs(row.contract_arrival_date) : null,
      actual_arrival_date: row.actual_arrival_date ? dayjs(row.actual_arrival_date) : null,
    })
    setOpen(true)
  }

  const submit = async () => {
    try {
      const v = await form.validateFields()
      const payload: any = {
        ...v,
        project_id: projectId,
        contract_arrival_date: v.contract_arrival_date?.format('YYYY-MM-DD') || null,
        actual_arrival_date: v.actual_arrival_date?.format('YYYY-MM-DD') || null,
      }
      if (editing?.id) {
        await window.api.equipment.update(editing.id, payload)
        message.success('已更新')
      } else {
        await window.api.equipment.create(payload)
        message.success('已新增')
      }
      setOpen(false)
      load()
    } catch (e: any) {
      if (e?.errorFields) return
      message.error(e.message || '保存失败')
    }
  }

  const remove = async (row: EquipmentRow) => {
    await window.api.equipment.remove(row.id!)
    message.success('已删除')
    load()
  }

  /** 下载导入模板 */
  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([{
      设备名称: '高压开关柜', 规格型号: 'KYN28-12', 设备位号: 'AH1', 品牌: '示例品牌',
      供货商: '示例供货商', 单位: '台', 数量: 2, 单价: 35000,
      合同到货日期: '2026-11-01', 实际到货日期: '', 到货状态: '未到货', 验收状态: '未验收',
      存放位置: '1号仓库', 备注: '',
    }])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '设备导入模板')
    XLSX.writeFile(wb, '设备导入模板.xlsx')
  }

  /** 解析并导入 */
  const handleImport = async (file: File) => {
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const raw: any[] = XLSX.utils.sheet_to_json(ws, { raw: false })
      if (!raw.length) {
        message.warning('文件中没有数据')
        return
      }
      const rows = raw.map((r) => ({
        name: r['设备名称'],
        model: r['规格型号'],
        tag_no: r['设备位号'],
        brand: r['品牌'],
        supplier: r['供货商'],
        unit: r['单位'] || '台',
        quantity: Number(r['数量']) || 0,
        unit_price: r['单价'] ? Number(r['单价']) : 0,
        contract_arrival_date: r['合同到货日期'] || null,
        actual_arrival_date: r['实际到货日期'] || null,
        arrival_status: r['到货状态'] || '未到货',
        accept_status: r['验收状态'] || '未验收',
        location: r['存放位置'],
        remark: r['备注'],
      }))
      const res = await window.api.equipment.importRows(projectId, rows)
      if (res.errors?.length) {
        Modal.info({
          title: `导入完成：新增 ${res.inserted}，更新 ${res.updated}，失败 ${res.errors.length}`,
          width: 560,
          content: (
            <div style={{ maxHeight: 300, overflow: 'auto' }}>
              {res.errors.map((e: any, i: number) => (
                <div key={i}><Typography.Text type="danger">第 {e.row} 行：{e.message}</Typography.Text></div>
              ))}
            </div>
          ),
        })
      } else {
        message.success(`导入完成：新增 ${res.inserted}，更新 ${res.updated}`)
      }
      load()
    } catch (e: any) {
      message.error('导入失败：' + (e.message || '文件格式错误'))
    }
  }

  const exportExcel = async () => {
    const rows = await window.api.equipment.exportRows(projectId)
    const data = rows.map((r) => ({
      设备名称: r.name, 规格型号: r.model, 设备位号: r.tag_no, 品牌: r.brand, 供货商: r.supplier,
      单位: r.unit, 数量: r.quantity, 单价: r.unit_price, 合同到货日期: r.contract_arrival_date,
      实际到货日期: r.actual_arrival_date, 到货状态: r.arrival_status, 验收状态: r.accept_status,
      存放位置: r.location, 备注: r.remark,
    }))
    const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ 提示: '暂无数据' }])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '设备台账')
    XLSX.writeFile(wb, `设备台账_${dayjs().format('YYYYMMDD')}.xlsx`)
  }

  const columns = [
    { title: '设备名称', dataIndex: 'name', width: 150, ellipsis: true },
    { title: '规格型号', dataIndex: 'model', width: 130, ellipsis: true },
    { title: '位号', dataIndex: 'tag_no', width: 80 },
    { title: '品牌', dataIndex: 'brand', width: 100, ellipsis: true },
    { title: '供货商', dataIndex: 'supplier', width: 120, ellipsis: true },
    { title: '数量', dataIndex: 'quantity', width: 90, render: (v: number, r: EquipmentRow) => `${v} ${r.unit}` },
    { title: '单价', dataIndex: 'unit_price', width: 90, render: (v: number) => (v ? `¥${v}` : '—') },
    { title: '合同到货', dataIndex: 'contract_arrival_date', width: 110 },
    { title: '实际到货', dataIndex: 'actual_arrival_date', width: 110 },
    { title: '到货状态', dataIndex: 'arrival_status', width: 95, render: (v: string) => <Tag color={STATUS_COLOR[v]}>{v}</Tag> },
    { title: '验收状态', dataIndex: 'accept_status', width: 95, render: (v: string) => <Tag color={STATUS_COLOR[v]}>{v}</Tag> },
    {
      title: '操作', width: 110, fixed: 'right' as const,
      render: (_: any, r: EquipmentRow) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确认删除该设备？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => remove(r)}>
            <Button type="link" size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Row gutter={12} style={{ marginBottom: 12 }} align="middle">
        <Col flex="auto">
          <Space wrap>
            <Input.Search placeholder="搜索设备名/型号/位号" allowClear style={{ width: 220 }} onSearch={setKw} />
            <Select
              placeholder="快捷筛选" allowClear style={{ width: 150 }} value={quick} onChange={setQuick}
              options={[
                { label: '仅看未到货', value: 'not_arrived' },
                { label: '仅看不合格', value: 'unqualified' },
                { label: '即将到货(7天)', value: 'upcoming' },
              ]}
            />
          </Space>
        </Col>
        <Col>
          <Space>
            <Button onClick={downloadTemplate}>下载模板</Button>
            <Upload beforeUpload={(f) => { handleImport(f as File); return false }} showUploadList={false} accept=".xlsx,.xls">
              <Button icon={<ImportOutlined />}>批量导入</Button>
            </Upload>
            <Button icon={<ExportOutlined />} onClick={exportExcel}>导出</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增设备</Button>
          </Space>
        </Col>
      </Row>

      <Table
        rowKey="id" size="small" loading={loading} columns={columns} dataSource={list}
        scroll={{ x: 1300 }}
        pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (t) => `共 ${t} 条设备` }}
        locale={{ emptyText: <div style={{ padding: 40 }}><Typography.Text type="secondary">暂无设备，可「新增设备」或「批量导入」</Typography.Text></div> }}
      />

      <Modal
        title={editing ? '编辑设备' : '新增设备'} open={open} onOk={submit} onCancel={() => setOpen(false)}
        width={680} okText="保存" cancelText="取消" destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Row gutter={16}>
            <Col span={16}>
              <Form.Item name="name" label="设备名称" rules={[{ required: true, message: '请输入设备名称' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="tag_no" label="设备位号"><Input /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="model" label="规格型号"><Input /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="brand" label="品牌/厂家"><Input /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="supplier" label="供货商"><Input /></Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="unit" label="单位" rules={[{ required: true }]}>
                <Select options={UNITS.map((u) => ({ label: u, value: u }))} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="quantity" label="数量" rules={[{ required: true, message: '请输入数量' }]}>
                <InputNumber style={{ width: '100%' }} min={0.01} precision={2} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="unit_price" label="单价(元)">
                <InputNumber style={{ width: '100%' }} min={0} precision={2} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                noStyle
                shouldUpdate={(prev, cur) => prev.arrival_status !== cur.arrival_status}
              >
                {({ getFieldValue }) => {
                  const st = getFieldValue('arrival_status')
                  return (
                    <Form.Item
                      name="actual_arrival_date"
                      label="实际到货日期"
                      rules={[{ required: ['已到货', '部分到货'].includes(st), message: '已/部分到货必须填实际到货日期' }]}
                    >
                      <DatePicker style={{ width: '100%' }} />
                    </Form.Item>
                  )
                }}
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="contract_arrival_date" label="合同到货日期">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="arrival_status" label="到货状态" rules={[{ required: true }]}>
                <Select options={ARRIVAL_STATUS.map((s) => ({ label: s, value: s }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="accept_status" label="验收状态" rules={[{ required: true }]}>
                <Select options={ACCEPT_STATUS.map((s) => ({ label: s, value: s }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="location" label="存放位置"><Input /></Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  )
}
