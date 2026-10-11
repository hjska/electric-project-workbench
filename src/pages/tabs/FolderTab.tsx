import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Breadcrumb, Button, Col, Empty, Input, Modal, Row, Segmented,
  Space, Table, Tag, Tooltip, Typography, message,
} from 'antd'
import {
  ExportOutlined, FileExcelOutlined, FileImageOutlined, FileOutlined,
  FilePdfOutlined, FileTextOutlined, FileWordOutlined, FolderFilled,
  HomeOutlined, PlusOutlined, ReloadOutlined, SyncOutlined,
} from '@ant-design/icons'
import type { FolderChangeItem, FolderEntry, FolderScanSummary } from '../../types'
import { humanAge, humanSize } from '../../utils/format'
import dayjs from 'dayjs'

const IMG_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']
/** 与主进程 NEW_WITHIN_DAYS 保持一致 */
const NEW_DAYS = 7

function iconFor(isDir: boolean, ext: string) {
  if (isDir) return <FolderFilled style={{ fontSize: 17, color: '#f7b955' }} />
  if (IMG_EXTS.includes(ext)) return <FileImageOutlined style={{ fontSize: 16, color: '#1668dc' }} />
  if (ext === 'pdf') return <FilePdfOutlined style={{ fontSize: 16, color: '#d4380d' }} />
  if (['xls', 'xlsx', 'csv'].includes(ext)) return <FileExcelOutlined style={{ fontSize: 16, color: '#389e0d' }} />
  if (['doc', 'docx'].includes(ext)) return <FileWordOutlined style={{ fontSize: 16, color: '#1668dc' }} />
  if (['dwg', 'dxf'].includes(ext)) return <FileOutlined style={{ fontSize: 16, color: '#13c2c2' }} />
  if (['txt', 'log', 'md'].includes(ext)) return <FileTextOutlined style={{ fontSize: 16, color: '#8c8c8c' }} />
  return <FileOutlined style={{ fontSize: 16, color: '#8c8c8c' }} />
}

function NewTag() {
  return <Tag color="blue" style={{ marginInlineEnd: 0, lineHeight: '16px', fontSize: 11 }}>新</Tag>
}

/** 改动时间单元格：7 天内标「新」，悬停显示相对时间 */
function TimeCell({ ms }: { ms: number }) {
  if (!ms) return <Typography.Text type="secondary">—</Typography.Text>
  const isNew = Date.now() - ms <= NEW_DAYS * 86400000
  return (
    <Tooltip title={humanAge(ms)}>
      <Space size={6}>
        <span style={{ color: isNew ? '#1677ff' : undefined, fontWeight: isNew ? 500 : undefined }}>
          {dayjs(ms).format('YYYY-MM-DD HH:mm')}
        </span>
        {isNew && <NewTag />}
      </Space>
    </Tooltip>
  )
}

/** 排序用的时间：目录取子树内最近改动，文件取自身 */
const timeOf = (r: FolderEntry) => (r.isDir ? (r.latestMtimeMs || r.mtimeMs) : r.mtimeMs)

export default function FolderTab({ projectId }: { projectId: number }) {
  const [mode, setMode] = useState<'browse' | 'recent'>('browse')

  // 目录浏览
  const [relPath, setRelPath] = useState('')
  const [base, setBase] = useState('')
  const [entries, setEntries] = useState<FolderEntry[]>([])
  const [summary, setSummary] = useState<FolderScanSummary | null>(null)
  const [loading, setLoading] = useState(false)

  // 最近改动
  const [recent, setRecent] = useState<FolderChangeItem[]>([])
  const [recentDays, setRecentDays] = useState(0)
  const [recentLoading, setRecentLoading] = useState(false)
  const [recentScanned, setRecentScanned] = useState(0)

  // 新建文件夹
  const [mkdirOpen, setMkdirOpen] = useState(false)
  const [newName, setNewName] = useState('')

  // 实时监控
  const [watching, setWatching] = useState(false)
  const [flash, setFlash] = useState<{ changes: number; at: number } | null>(null)

  const relPathRef = useRef(relPath)
  relPathRef.current = relPath
  const modeRef = useRef(mode)
  modeRef.current = mode
  const daysRef = useRef(recentDays)
  daysRef.current = recentDays
  const watchedRef = useRef(false)

  const load = useCallback(async (p: string) => {
    setLoading(true)
    try {
      const r = await window.api.folder.browse(projectId, p)
      setBase(r.base)
      setEntries(r.entries)
      setSummary(r.summary)
    } catch (e: any) {
      message.error(e.message || '读取目录失败')
      setEntries([])
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const loadRecent = useCallback(async (days: number) => {
    setRecentLoading(true)
    try {
      const r = await window.api.folder.recentChanges(projectId, { limit: 200, days })
      setRecent(r.items)
      setRecentScanned(r.scanned)
    } catch (e: any) {
      message.error(e.message || '读取最近改动失败')
      setRecent([])
    } finally {
      setRecentLoading(false)
    }
  }, [projectId])

  /** 挂载监控（失败后刷新时可重试，成功一次就不再叠加引用） */
  const ensureWatch = useCallback(async () => {
    if (watchedRef.current) return
    try {
      const r = await window.api.folder.watch(projectId)
      if (r.watching) {
        watchedRef.current = true
        setWatching(true)
      } else {
        setWatching(false)
      }
    } catch {
      setWatching(false)
    }
  }, [projectId])

  useEffect(() => {
    setRelPath('')
    setRecentDays(0)
    load('')
    if (modeRef.current === 'recent') loadRecent(0)
    ensureWatch()
    return () => {
      if (watchedRef.current) {
        watchedRef.current = false
        window.api.folder.unwatch(projectId)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (mode === 'recent') loadRecent(recentDays)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, recentDays])

  // 磁盘发生变化（用户直接往文件夹里丢文件）→ 自动刷新当前视图
  useEffect(() => {
    const off = window.api.folder.onChanged((p) => {
      if (!p || p.projectId !== projectId) return
      setFlash({ changes: p.changes, at: p.at })
      if (modeRef.current === 'recent') loadRecent(daysRef.current)
      else load(relPathRef.current)
    })
    return off
  }, [projectId, load, loadRecent])

  // 提示条 8 秒后自动消失
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 8000)
    return () => clearTimeout(t)
  }, [flash])

  const refresh = async () => {
    if (watchedRef.current) {
      await load(relPathRef.current)
      if (modeRef.current === 'recent') await loadRecent(daysRef.current)
    } else {
      if (modeRef.current === 'recent') await loadRecent(daysRef.current)
      else await load(relPathRef.current)
      await ensureWatch()
    }
  }

  const enter = (p: string) => { setRelPath(p); load(p) }

  const openEntry = async (e: FolderEntry) => {
    if (e.isDir) return enter(relPath ? `${relPath}/${e.name}` : e.name)
    const r = await window.api.folder.open(projectId, relPath ? `${relPath}/${e.name}` : e.name)
    if (!r.ok) message.error('打开失败：' + r.message)
  }

  const revealEntry = async (e: FolderEntry) => {
    if (e.isDir) return enter(relPath ? `${relPath}/${e.name}` : e.name)
    await window.api.folder.reveal(projectId, relPath ? `${relPath}/${e.name}` : e.name)
  }

  const openRecent = async (f: FolderChangeItem) => {
    const r = await window.api.folder.open(projectId, f.relPath)
    if (!r.ok) message.error('打开失败：' + r.message)
  }

  const openInExplorer = async () => {
    const p = mode === 'recent' ? '' : relPath
    const r = await window.api.folder.open(projectId, p)
    if (!r.ok) message.error('打开失败：' + r.message)
  }

  const doMkdir = async () => {
    const name = newName.trim()
    if (!name) return message.warning('请输入文件夹名称')
    try {
      await window.api.folder.mkdir(projectId, relPath, name)
      message.success('已创建文件夹')
      setMkdirOpen(false)
      setNewName('')
      load(relPath)
    } catch (e: any) {
      message.error(e.message || '创建失败')
    }
  }

  /** 从「最近改动」跳到文件所在目录 */
  const gotoFolderOf = (relFile: string) => {
    const p = relFile.split('/').slice(0, -1).join('/')
    setMode('browse')
    setRelPath(p)
    load(p)
  }

  const crumbs = relPath ? relPath.split('/').filter(Boolean) : []

  const dirColumns = useMemo(() => [
    {
      title: '名称',
      dataIndex: 'name',
      sorter: (a: FolderEntry, b: FolderEntry) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
      },
      defaultSortOrder: 'ascend' as const,
      render: (v: string, r: FolderEntry) => (
        <Space size={8}>
          {iconFor(r.isDir, r.ext)}
          <a onClick={() => openEntry(r)} style={{ fontWeight: r.isDir ? 500 : undefined }}>{v}</a>
          {!r.isDir && Date.now() - r.mtimeMs <= NEW_DAYS * 86400000 && <NewTag />}
        </Space>
      ),
    },
    {
      title: '内容',
      width: 150,
      sorter: (a: FolderEntry, b: FolderEntry) => (a.isDir ? (a.treeSize || 0) : a.size) - (b.isDir ? (b.treeSize || 0) : b.size),
      render: (_: any, r: FolderEntry) => (r.isDir ? (
        r.childCount ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {r.childCount} 个文件 · {humanSize(r.treeSize || 0)}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>空</Typography.Text>
        )
      ) : humanSize(r.size)),
    },
    {
      title: '改动时间',
      key: 'time',
      width: 190,
      sorter: (a: FolderEntry, b: FolderEntry) => timeOf(a) - timeOf(b),
      render: (_: any, r: FolderEntry) => <TimeCell ms={timeOf(r)} />,
    },
    {
      title: '创建时间',
      dataIndex: 'ctimeMs',
      width: 150,
      sorter: (a: FolderEntry, b: FolderEntry) => (a.ctimeMs || 0) - (b.ctimeMs || 0),
      render: (v: number) => (v ? (
        <Tooltip title={humanAge(v)}>
          <Typography.Text type="secondary">{dayjs(v).format('YYYY-MM-DD HH:mm')}</Typography.Text>
        </Tooltip>
      ) : '—'),
    },
    {
      title: '操作',
      width: 150,
      render: (_: any, r: FolderEntry) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => openEntry(r)}>{r.isDir ? '进入' : '打开'}</Button>
          <Button type="link" size="small" onClick={() => revealEntry(r)}>定位</Button>
        </Space>
      ),
    },
  ], [projectId, relPath])

  const recentColumns = useMemo(() => [
    {
      title: '文件',
      dataIndex: 'name',
      render: (v: string, r: FolderChangeItem) => (
        <Space size={8}>
          {iconFor(false, r.ext)}
          <a onClick={() => openRecent(r)}>{v}</a>
          {r.isNew && <NewTag />}
        </Space>
      ),
    },
    {
      title: '所在位置',
      dataIndex: 'relPath',
      width: 260,
      render: (v: string, r: FolderChangeItem) => {
        const dir = v.split('/').slice(0, -1).join(' / ')
        return (
          <Tooltip title={v}>
            <Space size={6}>
              <Tag color="default" style={{ marginInlineEnd: 0 }}>
                {r.topCategory === '(根目录)' ? '根目录' : r.topCategory}
              </Tag>
              {dir && <a onClick={() => gotoFolderOf(v)} style={{ fontSize: 12 }}>{dir}</a>}
            </Space>
          </Tooltip>
        )
      },
    },
    { title: '大小', dataIndex: 'size', width: 100, render: (v: number) => humanSize(v) },
    {
      title: '改动时间',
      dataIndex: 'mtimeMs',
      width: 190,
      defaultSortOrder: 'descend' as const,
      sorter: (a: FolderChangeItem, b: FolderChangeItem) => a.mtimeMs - b.mtimeMs,
      render: (v: number) => <TimeCell ms={v} />,
    },
    {
      title: '操作',
      width: 110,
      render: (_: any, r: FolderChangeItem) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => openRecent(r)}>打开</Button>
          <Button type="link" size="small" onClick={() => window.api.folder.reveal(projectId, r.relPath)}>定位</Button>
        </Space>
      ),
    },
  ], [projectId])

  const meta = useMemo(() => {
    if (!summary) return ''
    const parts = [`本层 ${entries.length} 项`]
    if (summary.files) parts.push(`共 ${summary.files} 个文件`)
    if (summary.size) parts.push(humanSize(summary.size))
    if (summary.latestMtimeMs) parts.push(`最近改动 ${humanAge(summary.latestMtimeMs)}`)
    return parts.join(' · ')
  }, [summary, entries.length])

  return (
    <div style={{ minHeight: 360 }}>
      {flash && (
        <Alert
          type="success"
          showIcon
          icon={<SyncOutlined spin />}
          style={{ marginBottom: 10 }}
          message={
            <span>
              检测到文件夹有变化（{flash.changes} 处），列表已自动刷新
              <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                {dayjs(flash.at).format('HH:mm:ss')}
              </Typography.Text>
            </span>
          }
          closable
          onClose={() => setFlash(null)}
        />
      )}

      <Row justify="space-between" align="middle" style={{ marginBottom: 10 }} gutter={[8, 8]}>
        <Col flex="auto" style={{ overflow: 'hidden' }}>
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            {mode === 'browse' ? (
              <Breadcrumb
                items={[
                  {
                    title: (
                      <a onClick={() => enter('')}>
                        <HomeOutlined /> {base ? base.split(/[\\/]/).pop() : '资料根目录'}
                      </a>
                    ),
                  },
                  ...crumbs.map((c, i) => ({
                    title: <a onClick={() => enter(crumbs.slice(0, i + 1).join('/'))} key={i}>{c}</a>,
                  })),
                ]}
              />
            ) : (
              <Space size={8}>
                <Typography.Text strong>最近改动</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  全项目扫描 {recentScanned} 个文件，按改动时间倒序
                </Typography.Text>
              </Space>
            )}
            <Space size={8}>
              <Tooltip title={base + (relPath ? '\\' + relPath.split('/').join('\\') : '')}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{meta}</Typography.Text>
              </Tooltip>
              {watching ? (
                <Tag icon={<SyncOutlined spin />} color="green" style={{ marginInlineEnd: 0 }}>
                  实时监控中，文件夹有新文件会自动出现
                </Tag>
              ) : (
                <Tag color="default" style={{ marginInlineEnd: 0 }}>未监控（文件夹不存在）</Tag>
              )}
            </Space>
          </Space>
        </Col>
        <Col>
          <Space wrap>
            <Segmented
              value={mode}
              onChange={(v) => setMode(v as any)}
              options={[
                { label: '目录浏览', value: 'browse' },
                { label: '最近改动', value: 'recent' },
              ]}
            />
            {mode === 'recent' && (
              <Segmented
                size="small"
                value={recentDays}
                onChange={(v) => setRecentDays(v as number)}
                options={[
                  { label: '全部', value: 0 },
                  { label: '近 7 天', value: 7 },
                  { label: '近 30 天', value: 30 },
                ]}
              />
            )}
            <Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>
            {mode === 'browse' && (
              <Button icon={<PlusOutlined />} onClick={() => { setNewName(''); setMkdirOpen(true) }}>新建文件夹</Button>
            )}
            <Button type="primary" icon={<ExportOutlined />} onClick={openInExplorer}>
              在资源管理器中打开
            </Button>
          </Space>
        </Col>
      </Row>

      {mode === 'browse' ? (
        <Table
          rowKey="name"
          size="small"
          loading={loading}
          columns={dirColumns as any}
          dataSource={entries}
          pagination={false}
          scroll={{ y: 420 }}
          onRow={(r) => ({ onDoubleClick: () => openEntry(r), style: { cursor: 'pointer' } })}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span>
                    这个目录还是空的
                    <br />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      直接在资源管理器里把图纸、程序拖进来就行，软件会自动识别并显示改动时间
                    </Typography.Text>
                  </span>
                }
              />
            ),
          }}
        />
      ) : (
        <Table
          rowKey="relPath"
          size="small"
          loading={recentLoading}
          columns={recentColumns as any}
          dataSource={recent}
          pagination={recent.length > 30 ? { pageSize: 30, size: 'small' } : false}
          scroll={{ y: 420 }}
          onRow={(r) => ({ onDoubleClick: () => openRecent(r), style: { cursor: 'pointer' } })}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span>
                    这段时间没有改动
                    <br />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      往资料文件夹里放文件后，这里会自动出现记录
                    </Typography.Text>
                  </span>
                }
              />
            ),
          }}
        />
      )}

      <Modal
        title="新建文件夹"
        open={mkdirOpen}
        onOk={doMkdir}
        onCancel={() => setMkdirOpen(false)}
        okText="创建"
        cancelText="取消"
        width={420}
      >
        <Input
          placeholder="文件夹名称"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onPressEnter={doMkdir}
          autoFocus
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          将创建在：{relPath ? relPath.split('/').join(' \\ ') : '资料根目录'}
        </Typography.Text>
      </Modal>
    </div>
  )
}
