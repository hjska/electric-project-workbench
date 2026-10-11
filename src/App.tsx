import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Layout, Menu, Typography, Tag, Space } from 'antd'
import {
  DashboardOutlined,
  ProjectOutlined,
  SettingOutlined,
  DatabaseOutlined,
  AppstoreOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import ProjectList from './pages/ProjectList'
import ProjectDetail from './pages/ProjectDetail'
import MaterialPage from './pages/MaterialPage'
import BackupPage from './pages/BackupPage'
import SettingsPage from './pages/SettingsPage'

const { Sider, Content, Header } = Layout

const menuItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '仪表盘' },
  { key: '/projects', icon: <ProjectOutlined />, label: '项目管理' },
  { key: '/materials', icon: <AppstoreOutlined />, label: '物料管理' },
  { key: '/backup', icon: <DatabaseOutlined />, label: '数据备份' },
  { key: '/settings', icon: <SettingOutlined />, label: '基础设置' },
]

export default function App() {
  const nav = useNavigate()
  const loc = useLocation()

  const selected = menuItems.find((m) => loc.pathname.startsWith(m.key))?.key || '/dashboard'

  useEffect(() => {
    document.title = '电气项目管理台'
  }, [])

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider width={190} theme="light" style={{ borderRight: '1px solid #e8eaed' }}>
        <div style={{ height: 56, display: 'flex', alignItems: 'center', padding: '0 18px', borderBottom: '1px solid #f0f0f0' }}>
          <Typography.Text strong style={{ fontSize: 15, color: '#1668dc' }}>
            ⚡ 电气项目管理台
          </Typography.Text>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selected]}
          items={menuItems}
          style={{ borderInlineEnd: 'none', marginTop: 8 }}
          onClick={(e) => nav(e.key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            height: 56,
            lineHeight: '56px',
            padding: '0 20px',
            borderBottom: '1px solid #e8eaed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Typography.Text strong style={{ fontSize: 15 }}>
            {menuItems.find((m) => m.key === selected)?.label || '项目管理'}
          </Typography.Text>
          <Space>
            <Tag color="blue">本地单机版</Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              v0.1.0
            </Typography.Text>
          </Space>
        </Header>
        <Content style={{ overflow: 'auto', background: '#f0f2f5' }}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/projects" element={<ProjectList />} />
            <Route path="/projects/:id" element={<ProjectDetail />} />
            <Route path="/materials" element={<MaterialPage />} />
            <Route path="/backup" element={<BackupPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  )
}
