import { useEffect, useState } from 'react'
import {
  Card, Typography, Descriptions, Space, Tag, Divider, Input, Button,
  message, Checkbox, Alert, Modal,
} from 'antd'
import {
  FolderOpenOutlined, SaveOutlined, ReloadOutlined, BuildOutlined, FolderAddOutlined,
} from '@ant-design/icons'
import { UNITS, WEATHER, SEVERITY, ARRIVAL_STATUS, ACCEPT_STATUS, PROCESS_STATUS, ATTACH_CATEGORY } from '../utils/dict'
import type { FolderNode, FolderSetting } from '../types'

/** 目录结构模板的文本 ⇄ 树 互转：每行一个目录，行首缩进两格表示子目录 */
function treeToText(tree: FolderNode[]) {
  const lines: string[] = []
  for (const n of tree || []) {
    lines.push(n.name)
    for (const c of n.children || []) lines.push('  ' + c)
  }
  return lines.join('\n')
}

function textToTree(text: string): FolderNode[] {
  const tree: FolderNode[] = []
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue
    const indentRaw = raw.match(/^[ \u3000\t]*/)?.[0] || ''
    const indent = indentRaw.replace(/\t/g, '  ').length
    const name = raw.trim()
    if (indent === 0 || tree.length === 0) tree.push({ name, children: [] })
    else tree[tree.length - 1].children!.push(name)
  }
  return tree
}

export default function SettingsPage() {
  const [info, setInfo] = useState<any>(null)
  const [setting, setSetting] = useState<FolderSetting | null>(null)
  const [root, setRoot] = useState('')
  const [treeText, setTreeText] = useState('')
  const [createReadme, setCreateReadme] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.app.getInfo().then(setInfo)
    window.api.folder.setting().then((s) => {
      setSetting(s)
      setRoot(s.root)
      setTreeText(treeToText(s.tree))
      setCreateReadme(s.createReadme)
    })
  }, [])

  const renderTags = (arr: string[]) => (
    <Space wrap size={4}>
      {arr.map((x) => <Tag key={x}>{x}</Tag>)}
    </Space>
  )

  const save = async () => {
    const tree = textToTree(treeText)
    if (!tree.length) return message.warning('目录结构不能为空')
    setSaving(true)
    try {
      const s = await window.api.folder.saveSetting({ root, tree, createReadme })
      setSetting(s)
      setRoot(s.root)
      setTreeText(treeToText(s.tree))
      setCreateReadme(s.createReadme)
      message.success('已保存。新设置对之后新建的项目生效，已有项目可用下方按钮补建。')
    } catch (e: any) {
      message.error(e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const pickRoot = async () => {
    const dir = await window.api.shell.selectDirectory()
    if (dir) setRoot(dir)
  }

  const openRoot = async () => {
    const r = await window.api.folder.openRoot()
    if (!r.ok) message.error('打开失败：' + r.message)
  }

  const resetTree = async () => {
    const t = await window.api.folder.defaultTree()
    setTreeText(treeToText(t))
    message.info('已恢复为默认结构，别忘了点「保存设置」')
  }

  const ensureAll = async () => {
    setBusy(true)
    try {
      const r = await window.api.folder.ensureAll()
      if (r.failed.length) {
        Modal.warning({
          title: `${r.failed.length} 个项目处理失败`,
          width: 520,
          content: (
            <div style={{ maxHeight: 260, overflow: 'auto' }}>
              {r.failed.map((f, i) => <div key={i}>· {f.code}：{f.message}</div>)}
            </div>
          ),
        })
      }
      message.success(`共 ${r.total} 个项目：新建 ${r.createdCount} 个，已存在并校验 ${r.skippedCount} 个`, 6)
    } catch (e: any) {
      message.error(e.message || '处理失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-container">
      <Card
        title="项目资料文件夹"
        size="small"
        extra={<Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>保存设置</Button>}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          message="新建项目时，软件会自动在下面的根目录里按「项目编号_项目名称」建好一个资料文件夹，并按右侧模板生成分类子目录，供你直接存放图纸、程序、说明书等文件。"
        />

        <Descriptions column={1} size="small" style={{ marginBottom: 4 }}>
          <Descriptions.Item label="资料根目录">
            <Space.Compact style={{ width: '100%', maxWidth: 640 }}>
              <Input value={root} onChange={(e) => setRoot(e.target.value)} placeholder="如 D:\电气项目资料" />
              <Button icon={<FolderOpenOutlined />} onClick={pickRoot}>选择</Button>
              <Button onClick={openRoot}>打开</Button>
            </Space.Compact>
          </Descriptions.Item>
        </Descriptions>

        <Divider style={{ margin: '12px 0' }} />

        <Typography.Text strong style={{ fontSize: 13 }}>文件夹内部分类结构</Typography.Text>
        <div style={{ marginTop: 6 }}>
          <Space align="start" size={16} style={{ width: '100%' }}>
            <Input.TextArea
              rows={13}
              value={treeText}
              onChange={(e) => setTreeText(e.target.value)}
              style={{ width: 380, fontFamily: 'Consolas, Menlo, monospace', fontSize: 13 }}
            />
            <div>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                · 每行一个文件夹名称<br />
                · 行首缩进 <b>两格</b> 表示它是上一行的子文件夹<br />
                · 一级目录建议加数字前缀（01-、02-…），保证排序稳定<br />
                · 用不到的分类删掉即可，不影响其它功能
              </Typography.Paragraph>
              <Button icon={<ReloadOutlined />} onClick={resetTree}>恢复默认结构</Button>
            </div>
          </Space>
        </div>

        <Divider style={{ margin: '14px 0 10px' }} />

        <div style={{ marginBottom: 14 }}>
          <Checkbox checked={createReadme} onChange={(e) => setCreateReadme(e.target.checked)}>
            在每个项目文件夹里生成一份《_资料说明.txt》，写明各目录该放什么（可随时删除）
          </Checkbox>
        </div>

        <Space>
          <Button icon={<FolderAddOutlined />} loading={busy} onClick={ensureAll}>
            为已有项目补建文件夹
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            按当前根目录与结构，把还没建过的项目补齐，已存在的只校验不改动。
          </Typography.Text>
        </Space>

        <Divider style={{ margin: '14px 0' }} />

        <Typography.Text strong style={{ fontSize: 13 }}>效果预览</Typography.Text>
        <div
          style={{
            marginTop: 6, padding: '10px 14px', background: '#fafafa',
            border: '1px solid #f0f0f0', borderRadius: 6, fontSize: 12.5,
            fontFamily: 'Consolas, Menlo, monospace', lineHeight: 1.8, color: '#444',
          }}
        >
          <div>{root || '资料根目录'}</div>
          <div>└─ PRJ-2026-001_3#配电室改造工程</div>
          {textToTree(treeText).map((n, i, arr) => {
            const lastParent = i === arr.length - 1
            const kids = n.children || []
            return (
              <div key={n.name}>
                <span>{lastParent && !kids.length ? '   └─ ' : '   ├─ '}{n.name}</span>
                {kids.map((c, j) => (
                  <div key={c}>
                    {'   '}{lastParent ? '   ' : '│  '}{j === kids.length - 1 ? '└─ ' : '├─ '}{c}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </Card>

      <Card title="数据字典（只读展示）" size="small" style={{ marginTop: 16 }}>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="计量单位">{renderTags(UNITS)}</Descriptions.Item>
          <Descriptions.Item label="天气选项">{renderTags(WEATHER)}</Descriptions.Item>
          <Descriptions.Item label="问题严重等级">{renderTags(SEVERITY)}</Descriptions.Item>
          <Descriptions.Item label="到货状态">{renderTags(ARRIVAL_STATUS)}</Descriptions.Item>
          <Descriptions.Item label="验收状态">{renderTags(ACCEPT_STATUS)}</Descriptions.Item>
          <Descriptions.Item label="工序状态">{renderTags(PROCESS_STATUS)}</Descriptions.Item>
          <Descriptions.Item label="附件分类">{renderTags(ATTACH_CATEGORY)}</Descriptions.Item>
        </Descriptions>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          注：枚举字典在代码中统一维护（src/utils/dict.ts），如需增减请联系开发调整。
        </Typography.Text>
      </Card>

      <Card title="应用信息" size="small" style={{ marginTop: 16 }}>
        <Descriptions column={1} size="small">
          <Descriptions.Item label="版本">{info?.version || '0.1.0'}</Descriptions.Item>
          <Descriptions.Item label="数据库路径"><Typography.Text code copyable>{info?.dbPath || '—'}</Typography.Text></Descriptions.Item>
          <Descriptions.Item label="附件目录"><Typography.Text code copyable>{info?.attachmentsDir || '—'}</Typography.Text></Descriptions.Item>
          <Descriptions.Item label="应用目录"><Typography.Text code copyable>{info?.root || '—'}</Typography.Text></Descriptions.Item>
          <Descriptions.Item label="资料根目录">
            <Typography.Text code copyable>{setting?.root || '—'}</Typography.Text>
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  )
}
