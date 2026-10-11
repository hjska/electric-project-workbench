import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Card, Tabs, Descriptions, Tag, Button, Space, Row, Col, Statistic, Spin, message, Typography, Tooltip } from 'antd'
import { ArrowLeftOutlined, ExportOutlined, FolderOpenOutlined } from '@ant-design/icons'
import type { FolderStats, ProjectRow } from '../types'
import { STATUS_COLOR } from '../utils/dict'
import { humanAge, humanSize } from '../utils/format'
import dayjs from 'dayjs'
import EquipmentTab from './tabs/EquipmentTab'
import ProcessTab from './tabs/ProcessTab'
import MilestoneTab from './tabs/MilestoneTab'
import IssueTab from './tabs/IssueTab'
import AttachmentTab from './tabs/AttachmentTab'
import FolderTab from './tabs/FolderTab'

export default function ProjectDetail() {
  const { id } = useParams()
  const projectId = Number(id)
  const nav = useNavigate()
  // 页签由 URL 驱动，便于从「物料管理」等处直接深链到指定页签
  const [searchParams, setSearchParams] = useSearchParams()
  const tabKey = searchParams.get('tab') || 'equipment'
  const [project, setProject] = useState<ProjectRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [fStats, setFStats] = useState<FolderStats | null>(null)
  const watchedRef = useRef(false)

  const load = async () => {
    setLoading(true)
    try {
      const p = await window.api.project.get(projectId)
      setProject(p)
    } catch (e: any) {
      message.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  /** 资料文件夹概览：文件数 / 占用 / 最近改动（磁盘实时统计） */
  const loadStats = useCallback(async () => {
    try {
      setFStats(await window.api.folder.stats(projectId))
    } catch { /* 目录被删等情况忽略，界面显示为空 */ }
  }, [projectId])

  useEffect(() => {
    load()
    loadStats()
  }, [projectId])

  // 用户直接在资源管理器里改文件夹时，头部概览跟着刷新
  useEffect(() => {
    let cancelled = false
    window.api.folder.watch(projectId)
      .then((r) => {
        if (cancelled) {
          if (r.watching) window.api.folder.unwatch(projectId)
          return
        }
        watchedRef.current = !!r.watching
      })
      .catch(() => { /* ignore */ })
    const off = window.api.folder.onChanged((p) => {
      if (p?.projectId === projectId) loadStats()
    })
    return () => {
      cancelled = true
      off()
      if (watchedRef.current) {
        watchedRef.current = false
        window.api.folder.unwatch(projectId)
      }
    }
  }, [projectId, loadStats])

  const exportSummary = async () => {
    const r = await window.api.report_export.projectSummary(projectId)
    if (r.canceled) return
    message.success('已导出：' + r.path)
  }

  const openFolder = async () => {
    try {
      const r = await window.api.folder.open(projectId)
      if (!r.ok) message.error('打开失败：' + r.message)
      else load() // 路径可能被重建，刷新一次拿到最新值
    } catch (e: any) {
      message.error(e.message || '打开文件夹失败')
    }
  }

  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><Spin size="large" /></div>
  if (!project) return null

  const s = project.summary

  return (
    <div className="page-container">
      <Card size="small" style={{ marginBottom: 12 }}>
        <Row align="middle" justify="space-between">
          <Col>
            <Space size={10}>
              <Button icon={<ArrowLeftOutlined />} size="small" onClick={() => nav('/projects')}>返回</Button>
              <Typography.Title level={5} style={{ margin: 0 }}>{project.name}</Typography.Title>
              <Tag color={STATUS_COLOR[project.status]}>{project.status}</Tag>
              <Typography.Text type="secondary">{project.code}</Typography.Text>
            </Space>
          </Col>
          <Col>
            <Space>
              <Button icon={<FolderOpenOutlined />} onClick={openFolder}>打开资料文件夹</Button>
              <Button icon={<ExportOutlined />} onClick={exportSummary}>导出项目汇总</Button>
            </Space>
          </Col>
        </Row>
        <Row gutter={16} style={{ marginTop: 14 }}>
          <Col span={4}><Statistic title="工序完成率" value={s?.progress ?? 0} suffix="%" valueStyle={{ fontSize: 20, color: '#1668dc' }} /></Col>
          <Col span={4}><Statistic title="设备到货率" value={s?.arrivalRate ?? 0} suffix="%" valueStyle={{ fontSize: 20, color: '#389e0d' }} /></Col>
          <Col span={4}><Statistic title="未闭环问题" value={s?.openIssue ?? 0} valueStyle={{ fontSize: 20, color: (s?.openIssue ?? 0) > 0 ? '#fa8c16' : undefined }} /></Col>
          <Col span={4}><Statistic title="逾期工序" value={s?.overdueProcess ?? 0} valueStyle={{ fontSize: 20, color: (s?.overdueProcess ?? 0) > 0 ? '#d4380d' : undefined }} /></Col>
          <Col span={4}>
            <Statistic
              title="资料文件"
              value={fStats?.exists ? fStats.fileCount : 0}
              suffix="个"
              valueStyle={{ fontSize: 20, color: (fStats?.recentCount ?? 0) > 0 ? '#fa8c16' : '#8c8c8c' }}
            />
          </Col>
        </Row>
        <Descriptions size="small" column={4} style={{ marginTop: 14 }}>
          <Descriptions.Item label="建设单位">{project.owner_unit || '—'}</Descriptions.Item>
          <Descriptions.Item label="施工单位">{project.build_unit || '—'}</Descriptions.Item>
          <Descriptions.Item label="监理单位">{project.supervise_unit || '—'}</Descriptions.Item>
          <Descriptions.Item label="项目经理">{project.manager}</Descriptions.Item>
          <Descriptions.Item label="开工日期">{project.start_date}</Descriptions.Item>
          <Descriptions.Item label="计划竣工">{project.plan_end_date}</Descriptions.Item>
          <Descriptions.Item label="实际竣工">{project.actual_end_date || '—'}</Descriptions.Item>
          <Descriptions.Item label="合同金额">{project.contract_amount ? `¥${project.contract_amount.toLocaleString()}` : '—'}</Descriptions.Item>
        </Descriptions>
        <Row align="middle" justify="space-between" gutter={[8, 4]} style={{ marginTop: 6 }}>
          <Col flex="auto" style={{ overflow: 'hidden' }}>
            <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>资料文件夹：</Typography.Text>
            {project.folder_path ? (
              <Typography.Text code style={{ fontSize: 12 }} copyable={{ text: project.folder_path }}>
                {project.folder_path}
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                尚未创建 —— 点右上角「打开资料文件夹」自动生成
              </Typography.Text>
            )}
          </Col>
          <Col>
            {fStats?.exists && (
              <Space size={8} wrap>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {fStats.fileCount ? `占用 ${humanSize(fStats.totalSize)} · ${fStats.dirCount} 个子目录` : '暂无资料'}
                </Typography.Text>
                {fStats.latestMtimeMs > 0 && (
                  <Tooltip title={`最近改动：${fStats.latestRelPath}`}>
                    <Tag color={(fStats.recentCount ?? 0) > 0 ? 'blue' : 'default'} style={{ marginInlineEnd: 0 }}>
                      最近改动 {dayjs(fStats.latestMtimeMs).format('MM-DD HH:mm')} · {humanAge(fStats.latestMtimeMs)}
                    </Tag>
                  </Tooltip>
                )}
                {fStats.recentCount > 0 && (
                  <Tag color="blue" style={{ marginInlineEnd: 0 }}>近 {fStats.newDays} 天 {fStats.recentCount} 项改动</Tag>
                )}
              </Space>
            )}
          </Col>
        </Row>
      </Card>

      <Card size="small" styles={{ body: { paddingTop: 0 } }}>
        <Tabs
          activeKey={tabKey}
          onChange={(k) => setSearchParams(k === 'equipment' ? {} : { tab: k }, { replace: true })}
          items={[
            { key: 'equipment', label: '设备清单', children: <EquipmentTab projectId={projectId} /> },
            { key: 'process', label: '工序进度', children: <ProcessTab projectId={projectId} /> },
            { key: 'milestone', label: '里程碑', children: <MilestoneTab projectId={projectId} /> },
            { key: 'issue', label: '问题记录', children: <IssueTab projectId={projectId} /> },
            { key: 'attachment', label: '附件', children: <AttachmentTab projectId={projectId} /> },
            { key: 'folder', label: '资料文件夹', children: <FolderTab projectId={projectId} /> },
          ]}
        />
      </Card>
    </div>
  )
}
