import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Card, Row, Col, Table, Button, Space, Tag, Modal, Form, Input, Select, DatePicker,
  InputNumber, message, Popconfirm, Typography, Tooltip, Progress, Segmented, Alert, Tabs, Empty,
} from 'antd'
import {
  PlusOutlined, ExportOutlined, ReloadOutlined, EditOutlined, DeleteOutlined,
  WarningOutlined, FieldTimeOutlined, CheckCircleOutlined, InboxOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import * as XLSX from 'xlsx'
import type {
  MaterialRow, MaterialStats, MaterialProjectGroup, MaterialSupplierGroup,
  MaterialFacets, MaterialView,
} from '../types'
import { ARRIVAL_STATUS, ACCEPT_STATUS, UNITS, STATUS_COLOR } from '../utils/dict'

/** 筛选下拉里代表「日常备品」的哨兵值（项目 id 从 1 开始，不会冲突） */
const COMMON = -1
/** 新增/编辑弹窗里代表「不归属项目」的取值（null 经表单不好表达，用 0） */
const NO_PROJECT = 0
const COMMON_LABEL = '日常备品（不归属项目）'

/** 数字展示：整数不带小数，小数最多两位 */
function num(v: number | undefined | null) {
  if (v === undefined || v === null) return '0'
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function money(v: number | undefined | null) {
  if (!v) return '—'
  return '¥' + num(v)
}

/** 把 SQLite 的唯一约束报错翻译成人话 */
function friendlyError(e: any) {
  const m = e?.message || '操作失败'
  if (/UNIQUE/i.test(m) && /equipment|uk_equip/i.test(m)) {
    return '同一归属下已存在同名同型号的物料（未指定项目时按「日常备品」判重），请修改名称/型号或更换项目'
  }
  return m
}

export default function MaterialPage() {
  const nav = useNavigate()
  const [tab, setTab] = useState('list')

  // 筛选条件
  const [view, setView] = useState<MaterialView>('all')
  const [projectId, setProjectId] = useState<number | undefined>()
  const [arrival, setArrival] = useState<string[]>([])
  const [accept, setAccept] = useState<string[]>([])
  const [supplier, setSupplier] = useState<string | undefined>()
  const [kw, setKw] = useState('')
  const [tick, setTick] = useState(0)

  // 数据
  const [list, setList] = useState<MaterialRow[]>([])
  const [stats, setStats] = useState<MaterialStats | null>(null)
  const [projGroups, setProjGroups] = useState<MaterialProjectGroup[]>([])
  const [supGroups, setSupGroups] = useState<MaterialSupplierGroup[]>([])
  const [facets, setFacets] = useState<MaterialFacets>({ suppliers: [], brands: [] })
  const [projectOptions, setProjectOptions] = useState<{ id: number; code: string; name: string; status: string }[]>([])
  const [loading, setLoading] = useState(false)

  // 交互状态
  const [sel, setSel] = useState<React.Key[]>([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<MaterialRow | null>(null)
  const [form] = Form.useForm()
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchForm] = Form.useForm()

  const query = useMemo(() => {
    const q: any = {}
    if (projectId === COMMON) q.common = true
    else if (projectId) q.projectId = projectId
    if (kw.trim()) q.keyword = kw.trim()
    if (arrival.length) q.arrival = arrival
    if (accept.length) q.accept = accept
    if (supplier) q.supplier = supplier
    if (view !== 'all') q.view = view
    return q
  }, [projectId, kw, arrival, accept, supplier, view])

  /** 「所属项目」下拉：额外带上「日常备品」这一虚拟归属 */
  const projectSelectOptions = useMemo(
    () => [
      { label: COMMON_LABEL, value: COMMON },
      ...projectOptions.map((p) => ({ label: `${p.code} ${p.name}`, value: p.id })),
    ],
    [projectOptions],
  )

  /** 汇总查询参数：id 为正数=具体项目，COMMON=只看备品，空=全部 */
  const groupQuery = useMemo(
    () => (projectId === COMMON ? { common: true } : projectId ? { projectId } : {}),
    [projectId],
  )

  /**
   * 汇总页签只按「项目 / 备品」收敛口径：总表的快捷视图与状态筛选在那里不适用，
   * 若不排除会出现「顶部指标被筛过、下方汇总表却是全量」的自相矛盾。
   */
  const scope = useMemo(() => {
    if (tab === 'list') return query
    return groupQuery
  }, [tab, query, groupQuery])

  const load = async () => {
    setLoading(true)
    try {
      const [rows, st] = await Promise.all([
        window.api.material.list(scope),
        window.api.material.stats(scope),
      ])
      setList(rows)
      setStats(st)
      if (tab === 'project') setProjGroups(await window.api.material.groupByProject(groupQuery))
      if (tab === 'supplier') setSupGroups(await window.api.material.groupBySupplier(groupQuery))
    } catch (e: any) {
      message.error(friendlyError(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [scope, tab, tick])

  useEffect(() => {
    window.api.project.options().then(setProjectOptions).catch(() => { /* ignore */ })
    window.api.material.facets().then(setFacets).catch(() => { /* ignore */ })
  }, [tick])

  const refresh = () => setTick((t) => t + 1)

  const resetFilters = () => {
    setView('all'); setProjectId(undefined); setArrival([]); setAccept([]); setSupplier(undefined); setKw('')
  }

  /* ---------- 新增 / 编辑 ---------- */

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({
      // 当前若正筛着「日常备品」，新增就默认落到备品池
      project_id: projectId === COMMON ? NO_PROJECT : projectId,
      unit: '台', quantity: 1, unit_price: 0,
      arrival_status: '未到货', accept_status: '未验收',
    })
    setOpen(true)
  }

  const openEdit = (row: MaterialRow) => {
    setEditing(row)
    form.setFieldsValue({
      ...row,
      project_id: row.project_id ?? NO_PROJECT,
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
        // 选「日常备品」时表单值是 0，落库要显式转成 null（undefined 会被 JSON 丢掉，导致改不动归属）
        project_id: v.project_id ? Number(v.project_id) : null,
        contract_arrival_date: v.contract_arrival_date?.format('YYYY-MM-DD') || null,
        actual_arrival_date: v.actual_arrival_date?.format('YYYY-MM-DD') || null,
      }
      if (editing?.id) {
        await window.api.material.update(editing.id, payload)
        message.success('已更新')
      } else {
        await window.api.material.create(payload)
        message.success('已新增')
      }
      setOpen(false)
      refresh()
    } catch (e: any) {
      if (e?.errorFields) return
      message.error(friendlyError(e))
    }
  }

  const remove = async (row: MaterialRow) => {
    try {
      await window.api.material.remove(row.id!)
      message.success('已删除')
      refresh()
    } catch (e: any) {
      message.error(friendlyError(e))
    }
  }

  /* ---------- 批量 ---------- */

  const openBatch = () => {
    batchForm.resetFields()
    setBatchOpen(true)
  }

  const submitBatch = async () => {
    try {
      const v = await batchForm.validateFields()
      const patch: any = {}
      if (v.arrival_status) patch.arrival_status = v.arrival_status
      if (v.accept_status) patch.accept_status = v.accept_status
      if (v.actual_arrival_date) patch.actual_arrival_date = v.actual_arrival_date.format('YYYY-MM-DD')
      if (!Object.keys(patch).length) {
        message.warning('请至少选择一项要修改的状态')
        return
      }
      const r = await window.api.material.batchStatus(sel.map(Number), patch)
      if (r.skipped.length) {
        Modal.info({
          title: `已更新 ${r.updated} 项，跳过 ${r.skipped.length} 项`,
          width: 560,
          content: (
            <div style={{ maxHeight: 320, overflow: 'auto' }}>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                以下条目不符合业务规则（如「未到货」不能有验收结果），未做修改：
              </Typography.Paragraph>
              {r.skipped.map((s) => (
                <div key={s.id} style={{ marginBottom: 4 }}>
                  <Typography.Text style={{ fontSize: 12 }}>
                    {s.project_name ? `【${s.project_name}】` : ''}{s.name || `#${s.id}`}
                  </Typography.Text>
                  <Typography.Text type="danger" style={{ fontSize: 12 }}> — {s.reason}</Typography.Text>
                </div>
              ))}
            </div>
          ),
        })
      } else {
        message.success(`已更新 ${r.updated} 项`)
      }
      setBatchOpen(false)
      setSel([])
      refresh()
    } catch (e: any) {
      if (e?.errorFields) return
      message.error(friendlyError(e))
    }
  }

  const removeSelected = async () => {
    const r = await window.api.material.removeMany(sel.map(Number))
    message.success(`已删除 ${r.deleted} 项`)
    setSel([])
    refresh()
  }

  /* ---------- 导出 ---------- */

  const exportExcel = () => {
    if (!list.length) {
      message.warning('当前筛选条件下没有数据')
      return
    }
    const data = list.map((r) => ({
      项目编号: r.project_code || '', 项目名称: r.is_common ? '（日常备品）' : r.project_name,
      设备名称: r.name, 规格型号: r.model, 设备位号: r.tag_no,
      品牌: r.brand, 供货商: r.supplier, 单位: r.unit,
      数量: r.quantity, 单价: r.unit_price, 金额: r.amount,
      合同到货日期: r.contract_arrival_date || '', 实际到货日期: r.actual_arrival_date || '',
      到货状态: r.arrival_status, 验收状态: r.accept_status,
      存放位置: r.location, 备注: r.remark,
      逾期天数: r.is_overdue && r.days_to_contract !== null ? Math.abs(r.days_to_contract) : '',
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '物料总表')
    XLSX.writeFile(wb, `物料总表_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`)
  }

  /* ---------- 表格列 ---------- */

  const cmpStr = (a: any, b: any) => String(a ?? '').localeCompare(String(b ?? ''), 'zh-CN', { numeric: true })

  const columns: any[] = [
    {
      title: '所属项目', dataIndex: 'project_code', width: 170, fixed: 'left',
      sorter: (a: MaterialRow, b: MaterialRow) => cmpStr(a.project_code, b.project_code),
      render: (_: any, r: MaterialRow) => (
        r.is_common ? (
          <Tooltip title="暂不归属任何项目，可在编辑里随时指定项目">
            <Tag color="purple" icon={<InboxOutlined />} style={{ marginInlineEnd: 0 }}>日常备品</Tag>
          </Tooltip>
        ) : (
          <div style={{ lineHeight: 1.3 }}>
            <a onClick={() => nav(`/projects/${r.project_id}?tab=equipment`)}>{r.project_name}</a>
            <div><Typography.Text type="secondary" style={{ fontSize: 11 }}>{r.project_code}</Typography.Text></div>
          </div>
        )
      ),
    },
    { title: '设备名称', dataIndex: 'name', width: 150, ellipsis: true, sorter: (a: MaterialRow, b: MaterialRow) => cmpStr(a.name, b.name) },
    { title: '规格型号', dataIndex: 'model', width: 130, ellipsis: true },
    {
      title: '数量', dataIndex: 'quantity', width: 90, align: 'right',
      sorter: (a: MaterialRow, b: MaterialRow) => a.quantity - b.quantity,
      render: (v: number, r: MaterialRow) => `${num(v)} ${r.unit}`,
    },
    {
      title: '单价', dataIndex: 'unit_price', width: 95, align: 'right',
      sorter: (a: MaterialRow, b: MaterialRow) => (a.unit_price || 0) - (b.unit_price || 0),
      render: (v: number) => money(v),
    },
    {
      title: '金额', dataIndex: 'amount', width: 120, align: 'right',
      sorter: (a: MaterialRow, b: MaterialRow) => a.amount - b.amount,
      render: (v: number) => <Typography.Text strong>{money(v)}</Typography.Text>,
    },
    {
      title: '合同到货', dataIndex: 'contract_arrival_date', width: 180,
      sorter: (a: MaterialRow, b: MaterialRow) => cmpStr(a.contract_arrival_date, b.contract_arrival_date),
      render: (v: string, r: MaterialRow) => {
        if (!v) return <Typography.Text type="secondary">—</Typography.Text>
        const d = r.days_to_contract
        let tag = null
        if (r.is_overdue) tag = <Tag color="error" style={{ marginInlineEnd: 0 }}>逾期 {Math.abs(d!)} 天</Tag>
        else if (r.arrival_status !== '已到货' && d !== null && d >= 0 && d <= 7) {
          tag = <Tag color="warning" style={{ marginInlineEnd: 0 }}>{d === 0 ? '今日应到' : `${d} 天`}</Tag>
        }
        return (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
            <span>{v}</span>{tag}
          </div>
        )
      },
    },
    {
      title: '到货状态', dataIndex: 'arrival_status', width: 95,
      filters: ARRIVAL_STATUS.map((s) => ({ text: s, value: s })),
      onFilter: (v: any, r: MaterialRow) => r.arrival_status === v,
      render: (v: string) => <Tag color={STATUS_COLOR[v]}>{v}</Tag>,
    },
    {
      title: '验收状态', dataIndex: 'accept_status', width: 95,
      filters: ACCEPT_STATUS.map((s) => ({ text: s, value: s })),
      onFilter: (v: any, r: MaterialRow) => r.accept_status === v,
      render: (v: string) => <Tag color={STATUS_COLOR[v]}>{v}</Tag>,
    },
    { title: '供货商', dataIndex: 'supplier', width: 120, ellipsis: true },
    { title: '品牌', dataIndex: 'brand', width: 100, ellipsis: true },
    { title: '位号', dataIndex: 'tag_no', width: 70 },
    {
      title: '实际到货', dataIndex: 'actual_arrival_date', width: 105,
      sorter: (a: MaterialRow, b: MaterialRow) => cmpStr(a.actual_arrival_date, b.actual_arrival_date),
      render: (v: string) => v || <Typography.Text type="secondary">—</Typography.Text>,
    },
    { title: '存放位置', dataIndex: 'location', width: 105, ellipsis: true },
    {
      title: '操作', width: 105, fixed: 'right',
      render: (_: any, r: MaterialRow) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确认删除该物料？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => remove(r)}>
            <Button type="link" size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  /* ---------- 渲染 ---------- */

  const st = stats

  const renderList = () => (
    <>
      <Row gutter={8} style={{ marginBottom: 10 }} align="middle">
        <Col flex="auto">
          <Space wrap size={8}>
            <Segmented
              value={view}
              onChange={(v) => setView(v as MaterialView)}
              options={[
                { label: '全部', value: 'all' },
                { label: '逾期未到货', value: 'overdue' },
                { label: '7天内应到货', value: 'upcoming' },
                { label: '待到货验收', value: 'pending_accept' },
                { label: '不合格', value: 'unqualified' },
              ]}
            />
          </Space>
        </Col>
        <Col>
          <Space size={8}>
            <Tooltip title="刷新">
              <Button icon={<ReloadOutlined />} onClick={refresh} />
            </Tooltip>
            <Button icon={<ExportOutlined />} onClick={exportExcel}>导出当前筛选</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增物料</Button>
          </Space>
        </Col>
      </Row>

      <Row gutter={8} style={{ marginBottom: 10 }} align="middle">
        <Col>
          <Select
            placeholder="全部归属（含日常备品）" allowClear style={{ width: 220 }} value={projectId}
            onChange={(v) => setProjectId(v)}
            options={projectSelectOptions}
          />
        </Col>
        <Col>
          <Select
            mode="multiple" allowClear placeholder="到货状态" style={{ minWidth: 160 }} value={arrival}
            onChange={setArrival} options={ARRIVAL_STATUS.map((s) => ({ label: s, value: s }))}
            maxTagCount="responsive"
          />
        </Col>
        <Col>
          <Select
            mode="multiple" allowClear placeholder="验收状态" style={{ minWidth: 160 }} value={accept}
            onChange={setAccept} options={ACCEPT_STATUS.map((s) => ({ label: s, value: s }))}
            maxTagCount="responsive"
          />
        </Col>
        <Col>
          <Select
            placeholder="供货商" allowClear style={{ width: 170 }} value={supplier} onChange={setSupplier}
            options={facets.suppliers.map((s) => ({ label: s, value: s }))}
          />
        </Col>
        <Col>
          <Input.Search
            placeholder="设备/型号/位号/品牌/项目" allowClear style={{ width: 220 }}
            onSearch={setKw} onChange={(e) => { if (!e.target.value) setKw('') }}
          />
        </Col>
        <Col>
          <Button type="link" onClick={resetFilters}>重置</Button>
        </Col>
      </Row>

      {sel.length > 0 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 10 }}
          message={
            <Space size={10} wrap>
              <Typography.Text>已选 <b>{sel.length}</b> 项</Typography.Text>
              <Button size="small" icon={<EditOutlined />} onClick={openBatch}>批量改状态</Button>
              <Popconfirm
                title={`确认删除选中的 ${sel.length} 项物料？`}
                description="删除后不可恢复（项目本身不受影响）"
                okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
                onConfirm={removeSelected}
              >
                <Button size="small" danger icon={<DeleteOutlined />}>批量删除</Button>
              </Popconfirm>
              <Button size="small" type="link" onClick={() => setSel([])}>取消选择</Button>
            </Space>
          }
        />
      )}

      <Table
        rowKey="id" size="small" loading={loading} columns={columns} dataSource={list}
        rowSelection={{ selectedRowKeys: sel, onChange: (keys) => setSel(keys), preserveSelectedRowKeys: true }}
        rowClassName={(r: MaterialRow) => (r.is_overdue ? 'row-overdue' : r.accept_status === '不合格' ? 'row-warn' : '')}
        scroll={{ x: 1700 }}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条物料` }}
        locale={{ emptyText: <div style={{ padding: 40 }}><Typography.Text type="secondary">当前条件下没有物料</Typography.Text></div> }}
      />
    </>
  )

  const projColumns: any[] = [
    {
      title: '项目', dataIndex: 'name', width: 220,
      render: (v: string, r: MaterialProjectGroup) => (
        r.is_common ? (
          <Tooltip title="暂不归属任何项目的公共备件/库存">
            <Tag color="purple" icon={<InboxOutlined />} style={{ marginInlineEnd: 0 }}>日常备品</Tag>
          </Tooltip>
        ) : (
          <div style={{ lineHeight: 1.3 }}>
            <a onClick={() => nav(`/projects/${r.id}?tab=equipment`)}>{v}</a>
            <div><Typography.Text type="secondary" style={{ fontSize: 11 }}>{r.code}</Typography.Text></div>
          </div>
        )
      ),
    },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (v: string) => (v ? <Tag color={STATUS_COLOR[v]}>{v}</Tag> : <Typography.Text type="secondary">—</Typography.Text>),
    },
    { title: '物料条目', dataIndex: 'items', width: 90, align: 'right' },
    { title: '总数量', dataIndex: 'qty', width: 110, align: 'right', render: (v: number) => num(v) },
    { title: '总金额', dataIndex: 'amount', width: 140, align: 'right', render: (v: number) => money(v) },
    {
      title: '到货率（按数量）', dataIndex: 'arrived_qty', width: 190,
      render: (_: any, r: MaterialProjectGroup) => {
        const rate = r.qty > 0 ? Math.round((r.arrived_qty / r.qty) * 100) : 0
        return (
          <Tooltip title={`已到货 ${num(r.arrived_qty)} / ${num(r.qty)}`}>
            <Progress percent={rate} size="small" strokeColor={rate >= 100 ? '#389e0d' : '#1668dc'} />
          </Tooltip>
        )
      },
    },
    {
      title: '未到货', dataIndex: 'not_arrived', width: 80, align: 'right',
      render: (v: number) => (v > 0 ? <Typography.Text>{v}</Typography.Text> : <Typography.Text type="secondary">0</Typography.Text>),
    },
    {
      title: '逾期未到货', dataIndex: 'overdue', width: 100, align: 'right',
      render: (v: number) => (v > 0 ? <Tag color="error">{v}</Tag> : <Typography.Text type="secondary">0</Typography.Text>),
    },
    {
      title: '待到货验收', dataIndex: 'pending_accept', width: 100, align: 'right',
      render: (v: number) => (v > 0 ? <Tag color="warning">{v}</Tag> : <Typography.Text type="secondary">0</Typography.Text>),
    },
    {
      title: '不合格', dataIndex: 'unqualified', width: 80, align: 'right',
      render: (v: number) => (v > 0 ? <Tag color="error">{v}</Tag> : <Typography.Text type="secondary">0</Typography.Text>),
    },
    {
      title: '操作', width: 90, fixed: 'right',
      render: (_: any, r: MaterialProjectGroup) => (
        <Button type="link" size="small" onClick={() => openProjectInList(r.is_common ? COMMON : r.id)}>筛选</Button>
      ),
    },
  ]

  const openProjectInList = (id: number) => {
    setProjectId(id); setTab('list')
  }

  const supColumns: any[] = [
    {
      title: '供货商', dataIndex: 'name', width: 200, ellipsis: true,
      render: (v: string, r: MaterialSupplierGroup) => (
        <Space size={4}>
          <span>{v}</span>
          {r.common_items > 0 && (
            <Tooltip title={`其中 ${r.common_items} 条属于日常备品`}>
              <Tag color="purple" style={{ marginInlineEnd: 0 }}>备品 {r.common_items}</Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: '涉及项目', dataIndex: 'project_count', width: 90, align: 'right',
      render: (v: number) => (v > 0 ? v : <Typography.Text type="secondary">—</Typography.Text>),
    },
    { title: '物料条目', dataIndex: 'items', width: 90, align: 'right' },
    { title: '总数量', dataIndex: 'qty', width: 110, align: 'right', render: (v: number) => num(v) },
    { title: '总金额', dataIndex: 'amount', width: 150, align: 'right', render: (v: number) => money(v) },
    { title: '未到货', dataIndex: 'not_arrived', width: 90, align: 'right' },
    {
      title: '逾期未到货', dataIndex: 'overdue', width: 100, align: 'right',
      render: (v: number) => (v > 0 ? <Tag color="error">{v}</Tag> : <Typography.Text type="secondary">0</Typography.Text>),
    },
    {
      title: '待到货验收', dataIndex: 'pending_accept', width: 100, align: 'right',
      render: (v: number) => (v > 0 ? <Tag color="warning">{v}</Tag> : <Typography.Text type="secondary">0</Typography.Text>),
    },
    {
      title: '不合格', dataIndex: 'unqualified', width: 80, align: 'right',
      render: (v: number) => (v > 0 ? <Tag color="error">{v}</Tag> : <Typography.Text type="secondary">0</Typography.Text>),
    },
    {
      title: '操作', width: 100, fixed: 'right',
      render: (_: any, r: MaterialSupplierGroup) => (
        <Button type="link" size="small" onClick={() => { setTab('list'); setSupplier(r.name) }}>筛选</Button>
      ),
    },
  ]

  /** 汇总页签专用工具条：只保留「项目 / 日常备品」这一维度 */
  const groupToolbar = (
    <Row gutter={8} style={{ marginBottom: 10 }} align="middle">
      <Col>
        <Select
          placeholder="全部归属（含日常备品）" allowClear style={{ width: 240 }} value={projectId}
          onChange={(v) => setProjectId(v)}
          options={projectSelectOptions}
        />
      </Col>
      <Col flex="auto">
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          下面的汇总按当前归属口径统计（总表的快捷视图与状态筛选在此不适用）
        </Typography.Text>
      </Col>
      <Col>
        <Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>
      </Col>
    </Row>
  )

  const renderProjectGroups = () => {
    const t = projGroups.reduce(
      (a, r) => ({ items: a.items + r.items, qty: a.qty + r.qty, amount: a.amount + r.amount }),
      { items: 0, qty: 0, amount: 0 },
    )
    return (
      <>
      {groupToolbar}
      <Table
        rowKey="id" size="small" loading={loading} columns={projColumns} dataSource={projGroups}
        scroll={{ x: 1400 }} pagination={false}
        summary={() => (
          <Table.Summary.Row style={{ fontWeight: 600, background: '#fafafa' }}>
            <Table.Summary.Cell index={0}>合计</Table.Summary.Cell>
            <Table.Summary.Cell index={1} />
            <Table.Summary.Cell index={2} align="right">{t.items}</Table.Summary.Cell>
            <Table.Summary.Cell index={3} align="right">{num(t.qty)}</Table.Summary.Cell>
            <Table.Summary.Cell index={4} align="right">{money(t.amount)}</Table.Summary.Cell>
            <Table.Summary.Cell index={5} />
            <Table.Summary.Cell index={6} />
            <Table.Summary.Cell index={7} />
            <Table.Summary.Cell index={8} />
            <Table.Summary.Cell index={9} />
            <Table.Summary.Cell index={10} />
          </Table.Summary.Row>
        )}
      />
      </>
    )
  }

  const renderSupplierGroups = () => {
    if (!supGroups.length) {
      return <>{groupToolbar}<Empty description="还没有填写供货商的物料" style={{ marginTop: 60 }} /></>
    }
    const t = supGroups.reduce(
      (a, r) => ({ items: a.items + r.items, qty: a.qty + r.qty, amount: a.amount + r.amount }),
      { items: 0, qty: 0, amount: 0 },
    )
    return (
      <>
      {groupToolbar}
      <Table
        rowKey="name" size="small" loading={loading} columns={supColumns} dataSource={supGroups}
        scroll={{ x: 1100 }} pagination={false}
        summary={() => (
          <Table.Summary.Row style={{ fontWeight: 600, background: '#fafafa' }}>
            <Table.Summary.Cell index={0}>合计（{supGroups.length} 家）</Table.Summary.Cell>
            <Table.Summary.Cell index={1} />
            <Table.Summary.Cell index={2} align="right">{t.items}</Table.Summary.Cell>
            <Table.Summary.Cell index={3} align="right">{num(t.qty)}</Table.Summary.Cell>
            <Table.Summary.Cell index={4} align="right">{money(t.amount)}</Table.Summary.Cell>
            <Table.Summary.Cell index={5} />
            <Table.Summary.Cell index={6} />
            <Table.Summary.Cell index={7} />
            <Table.Summary.Cell index={8} />
            <Table.Summary.Cell index={9} />
          </Table.Summary.Row>
        )}
      />
      </>
    )
  }

  return (
    <div className="page-container">
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col span={4}>
          <Card size="small" hoverable={false} styles={{ body: { padding: '10px 12px' } }}>
            <div className="metric-label">物料条目</div>
            <div style={{ fontSize: 22, fontWeight: 600, lineHeight: '30px' }}>
              {num(st?.items ?? 0)}
              <span style={{ fontSize: 12, color: '#8c8c8c', marginLeft: 3 }}>条</span>
            </div>
            <div style={{ fontSize: 11, color: '#8c8c8c' }}>涉及 {st?.project_count ?? 0} 个项目 · {st?.supplier_count ?? 0} 家供货商</div>
            {(st?.common_items ?? 0) > 0 && (
              <div style={{ fontSize: 11, color: '#722ed1' }}>含日常备品 {st?.common_items} 条</div>
            )}
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small" styles={{ body: { padding: '10px 12px' } }}>
            <div className="metric-label">合计数量</div>
            <div style={{ fontSize: 22, fontWeight: 600, lineHeight: '30px' }}>{num(st?.total_qty ?? 0)}</div>
            <div style={{ fontSize: 11, color: '#8c8c8c' }}>未到货 {st?.not_arrived ?? 0} · 部分 {st?.partial ?? 0} · 已到货 {st?.arrived ?? 0}</div>
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small" styles={{ body: { padding: '10px 12px' } }}>
            <div className="metric-label">合计金额</div>
            <div style={{ fontSize: 22, fontWeight: 600, lineHeight: '30px', color: '#1668dc' }}>{money(st?.total_amount ?? 0)}</div>
            <div style={{ fontSize: 11, color: '#8c8c8c' }}>按数量×单价估算</div>
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small" styles={{ body: { padding: '10px 12px' } }}>
            <div className="metric-label">到货率（按数量）</div>
            <Progress
              percent={st?.arrival_rate ?? 0} size="small"
              strokeColor={(st?.arrival_rate ?? 0) >= 100 ? '#389e0d' : '#1668dc'}
              style={{ marginBottom: 0 }}
            />
            <div style={{ fontSize: 11, color: '#8c8c8c' }}>已到货 {num(st?.arrived_qty ?? 0)} / {num(st?.total_qty ?? 0)}</div>
          </Card>
        </Col>
        <Col span={4}>
          <Card
            size="small" hoverable onClick={() => setView('overdue')}
            styles={{ body: { padding: '10px 12px', cursor: 'pointer' } }}
          >
            <div className="metric-label"><WarningOutlined /> 逾期未到货</div>
            <div style={{ fontSize: 22, fontWeight: 600, lineHeight: '30px', color: (st?.overdue ?? 0) > 0 ? '#d4380d' : undefined }}>
              {st?.overdue ?? 0}
              <span style={{ fontSize: 12, color: '#8c8c8c', marginLeft: 3 }}>条</span>
            </div>
            <div style={{ fontSize: 11, color: '#8c8c8c' }}>超过合同到货日期仍未到</div>
          </Card>
        </Col>
        <Col span={4}>
          <Card
            size="small" hoverable onClick={() => setView('pending_accept')}
            styles={{ body: { padding: '10px 12px', cursor: 'pointer' } }}
          >
            <div className="metric-label"><CheckCircleOutlined /> 待到货验收</div>
            <div style={{ fontSize: 22, fontWeight: 600, lineHeight: '30px', color: (st?.pending_accept ?? 0) > 0 ? '#fa8c16' : undefined }}>
              {st?.pending_accept ?? 0}
              <span style={{ fontSize: 12, color: '#8c8c8c', marginLeft: 3 }}>条</span>
            </div>
            <div style={{ fontSize: 11, color: '#8c8c8c' }}>已到货但未验收</div>
          </Card>
        </Col>
      </Row>

      <Card size="small" styles={{ body: { paddingTop: 8 } }}>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: 'list', label: <span><FieldTimeOutlined /> 物料总表</span>, children: renderList() },
            { key: 'project', label: '按项目汇总', children: renderProjectGroups() },
            { key: 'supplier', label: '按供货商汇总', children: renderSupplierGroups() },
          ]}
        />
      </Card>

      {/* 新增 / 编辑物料 */}
      <Modal
        title={editing ? '编辑物料' : '新增物料'} open={open} onOk={submit} onCancel={() => setOpen(false)}
        width={720} okText="保存" cancelText="取消" destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item
                name="project_id"
                label="所属项目"
                extra="日常备品（暂无归属的公共备件/库存）直接选第一项；以后要挂到项目，编辑里改一下即可"
              >
                <Select
                  showSearch optionFilterProp="label" allowClear
                  placeholder="选择这个物料属于哪个项目（可留空）"
                  options={[
                    { label: `（${COMMON_LABEL}）`, value: NO_PROJECT },
                    ...projectOptions.map((p) => ({ label: `${p.code} ${p.name}`, value: p.id })),
                  ]}
                />
              </Form.Item>
            </Col>
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
                  const s = getFieldValue('arrival_status')
                  return (
                    <Form.Item
                      name="actual_arrival_date"
                      label="实际到货日期"
                      rules={[{ required: ['已到货', '部分到货'].includes(s), message: '已/部分到货必须填实际到货日期' }]}
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

      {/* 批量改状态 */}
      <Modal
        title="批量修改状态" open={batchOpen} onOk={submitBatch} onCancel={() => setBatchOpen(false)}
        width={520} okText="应用" cancelText="取消" destroyOnClose
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
          将同时修改已选中的 <b>{sel.length}</b> 项物料；留空表示该项不修改。
        </Typography.Paragraph>
        <Form form={batchForm} layout="vertical">
          <Form.Item name="arrival_status" label="到货状态">
            <Select allowClear placeholder="不修改" options={ARRIVAL_STATUS.map((s) => ({ label: s, value: s }))} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(p, c) => p.arrival_status !== c.arrival_status}>
            {({ getFieldValue }) => {
              const s = getFieldValue('arrival_status')
              if (!['已到货', '部分到货'].includes(s)) return null
              return (
                <Form.Item name="actual_arrival_date" label="实际到货日期" extra="留空则默认取今天">
                  <DatePicker style={{ width: '100%' }} />
                </Form.Item>
              )
            }}
          </Form.Item>
          <Form.Item name="accept_status" label="验收状态">
            <Select allowClear placeholder="不修改" options={ACCEPT_STATUS.map((s) => ({ label: s, value: s }))} />
          </Form.Item>
          <Alert
            type="warning" showIcon
            message="「未到货」与验收结果互斥"
            description="若某条物料不满足业务规则，该条会被跳过并列出原因，其余照常更新。"
            style={{ fontSize: 12 }}
          />
        </Form>
      </Modal>
    </div>
  )
}
