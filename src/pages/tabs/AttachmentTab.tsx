import { useEffect, useState } from 'react'
import {
  Button, Space, Tag, Modal, message, Popconfirm, Row, Col, Typography, Empty,
  Segmented, Card, Image, Input, Tooltip, Spin,
} from 'antd'
import {
  UploadOutlined, FileImageOutlined, FilePdfOutlined, FileExcelOutlined,
  FileWordOutlined, FileOutlined, DeleteOutlined, FolderOpenOutlined, EyeOutlined,
} from '@ant-design/icons'
import type { AttachmentRow } from '../../types'
import { ATTACH_CATEGORY } from '../../utils/dict'
import dayjs from 'dayjs'

const IMG_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']

function iconFor(ext?: string) {
  if (!ext) return <FileOutlined style={{ fontSize: 34, color: '#8c8c8c' }} />
  if (IMG_EXTS.includes(ext)) return <FileImageOutlined style={{ fontSize: 34, color: '#1668dc' }} />
  if (ext === 'pdf') return <FilePdfOutlined style={{ fontSize: 34, color: '#d4380d' }} />
  if (['xls', 'xlsx'].includes(ext)) return <FileExcelOutlined style={{ fontSize: 34, color: '#389e0d' }} />
  if (['doc', 'docx'].includes(ext)) return <FileWordOutlined style={{ fontSize: 34, color: '#1668dc' }} />
  return <FileOutlined style={{ fontSize: 34, color: '#8c8c8c' }} />
}

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export default function AttachmentTab({ projectId }: { projectId: number }) {
  const [list, setList] = useState<AttachmentRow[]>([])
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [category, setCategory] = useState<string | undefined>()
  const [previewIdx, setPreviewIdx] = useState<number>(-1)

  const load = async () => {
    setLoading(true)
    try {
      setList(await window.api.attachment.list({ projectId, category }))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [projectId, category])

  const upload = async () => {
    const res = await window.api.attachment.pickAndUpload(projectId, '项目', null, category)
    if (res.added) message.success(`已上传 ${res.added} 个文件`)
    if (res.errors?.length) {
      Modal.warning({
        title: `${res.errors.length} 个文件未能上传`,
        content: (
          <div>
            {res.errors.map((e: any, i: number) => (
              <div key={i}>· {e.file}：{e.message}</div>
            ))}
          </div>
        ),
      })
    }
    load()
  }

  const remove = async (row: AttachmentRow) => {
    await window.api.attachment.remove(row.id)
    message.success('已删除（物理文件已同步清理）')
    load()
  }

  const open = async (row: AttachmentRow) => {
    const r = await window.api.attachment.open(row.id)
    if (!r.ok) message.error('打开失败：' + r.message)
  }

  const images = list.filter((a) => a.file_ext && IMG_EXTS.includes(a.file_ext))

  return (
    <div style={{ minHeight: 320 }}>
      <Row justify="space-between" style={{ marginBottom: 12 }} align="middle">
        <Col>
          <Space>
            <Segmented
              value={view}
              onChange={(v) => setView(v as any)}
              options={[{ label: '网格', value: 'grid' }, { label: '列表', value: 'list' }]}
            />
            <Space size={2}>
              <a onClick={() => setCategory(undefined)} className={!category ? 'text-danger' : ''}>
                <Tag color={!category ? 'blue' : undefined}>全部</Tag>
              </a>
              {ATTACH_CATEGORY.map((c) => (
                <a key={c} onClick={() => setCategory(c)}>
                  <Tag color={category === c ? 'blue' : undefined}>{c}</Tag>
                </a>
              ))}
            </Space>
          </Space>
        </Col>
        <Col>
          <Button type="primary" icon={<UploadOutlined />} onClick={upload}>上传附件</Button>
        </Col>
      </Row>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
      ) : view === 'grid' ? (
        list.length ? (
          <div className="attachment-grid">
            {list.map((a, idx) => (
              <div className="attachment-card" key={a.id}>
                <div
                  className="attachment-thumb"
                  onClick={() => (a.file_ext && IMG_EXTS.includes(a.file_ext) ? setPreviewIdx(idx) : open(a))}
                >
                  {a.file_ext && IMG_EXTS.includes(a.file_ext) ? (
                    <img src={`file://${a.abs_path}`} alt={a.file_name} onError={(e) => { (e.target as any).style.display = 'none' }} />
                  ) : (
                    iconFor(a.file_ext)
                  )}
                </div>
                <div className="attachment-meta">
                  <Tooltip title={a.file_name}>
                    <div className="attachment-name" style={{ fontWeight: 500 }}>{a.file_name}</div>
                  </Tooltip>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {humanSize(a.file_size)} · {dayjs(a.created_at).format('MM-DD')}
                    </Typography.Text>
                    <Space size={2}>
                      <a onClick={() => open(a)}><FolderOpenOutlined style={{ fontSize: 12 }} /></a>
                      <Popconfirm title="删除后物理文件一并清除，确认？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => remove(a)}>
                        <a><DeleteOutlined style={{ fontSize: 12, color: '#d4380d' }} /></a>
                      </Popconfirm>
                    </Space>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty description="暂无附件，点「上传附件」添加照片或图纸" style={{ marginTop: 80 }} />
        )
      ) : (
        <ListTable list={list} onOpen={open} onRemove={remove} />
      )}

      {/* 图片预览 */}
      {previewIdx >= 0 && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
          }}
          onClick={() => setPreviewIdx(-1)}
        >
          <img
            src={`file://${images[previewIdx]?.abs_path}`}
            style={{ maxWidth: '85vw', maxHeight: '78vh', objectFit: 'contain' }}
            onClick={(e) => e.stopPropagation()}
          />
          <div style={{ color: '#fff', marginTop: 16 }} onClick={(e) => e.stopPropagation()}>
            <Space>
              <Button disabled={previewIdx <= 0} onClick={() => setPreviewIdx(previewIdx - 1)}>上一张</Button>
              <Typography.Text style={{ color: '#fff' }}>
                {previewIdx + 1} / {images.length} ｜ {images[previewIdx]?.file_name}
              </Typography.Text>
              <Button disabled={previewIdx >= images.length - 1} onClick={() => setPreviewIdx(previewIdx + 1)}>下一张</Button>
              <Button onClick={() => setPreviewIdx(-1)}>关闭</Button>
            </Space>
          </div>
        </div>
      )}
    </div>
  )
}

function ListTable({ list, onOpen, onRemove }: { list: AttachmentRow[]; onOpen: (r: AttachmentRow) => void; onRemove: (r: AttachmentRow) => void }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ background: '#f5f7fa', textAlign: 'left' }}>
          <th style={{ padding: 8, borderBottom: '1px solid #e8eaed' }}>文件名</th>
          <th style={{ padding: 8, borderBottom: '1px solid #e8eaed', width: 90 }}>分类</th>
          <th style={{ padding: 8, borderBottom: '1px solid #e8eaed', width: 100 }}>大小</th>
          <th style={{ padding: 8, borderBottom: '1px solid #e8eaed', width: 150 }}>上传时间</th>
          <th style={{ padding: 8, borderBottom: '1px solid #e8eaed', width: 120 }}>操作</th>
        </tr>
      </thead>
      <tbody>
        {list.map((a) => (
          <tr key={a.id}>
            <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>
              <Space size={6}>{iconFor(a.file_ext)}<span>{a.file_name}</span></Space>
            </td>
            <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}><Tag>{a.category}</Tag></td>
            <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>{humanSize(a.file_size)}</td>
            <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>{a.created_at}</td>
            <td style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>
              <Space size={4}>
                <Button type="link" size="small" onClick={() => onOpen(a)}>打开</Button>
                <Popconfirm title="删除后物理文件一并清除，确认？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => onRemove(a)}>
                  <Button type="link" size="small" danger>删除</Button>
                </Popconfirm>
              </Space>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
