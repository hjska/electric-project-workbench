import { ipcMain, WebContents } from 'electron'
import { saveSheets, stamp } from './export.ipc'
import { getDb } from '../db/index'
import { listAllEquipment } from '../service/equipment.service'
import { listIssues } from '../service/issue.service'
import { listProcess } from '../service/process.service'
import { getProject } from '../service/project.service'
import { projectSummary } from '../service/stats.service'

export function registerExportIpc() {
  ipcMain.handle('export:projectSummary', async (e, projectId: number) => {
    const p = getProject(projectId) as any
    const s = projectSummary(projectId)
    const infoSheet = [{
      项目编号: p.code, 项目名称: p.name, 项目地址: p.address, 建设单位: p.owner_unit,
      施工单位: p.build_unit, 监理单位: p.supervise_unit, 项目经理: p.manager, 联系电话: p.phone,
      合同金额: p.contract_amount, 开工日期: p.start_date, 计划竣工: p.plan_end_date,
      实际竣工: p.actual_end_date, 项目状态: p.status, 备注: p.remark,
      工序完成率: s.progress + '%', 设备到货率: s.arrivalRate + '%', 未闭环问题数: s.openIssue,
    }]
    const processRows = (listProcess(projectId) as any[]).map((r) => ({
      序号: r.seq_no, 工序名称: r.name, 计划开始: r.plan_start, 计划结束: r.plan_end,
      实际开始: r.actual_start, 实际结束: r.actual_end, 计划总量: r.plan_qty, 完成量: r.done_qty,
      单位: r.qty_unit, 完成率: Math.round((r.ratio ?? 0) * 100) + '%', 权重: r.weight,
      负责人: r.owner, 状态: r.status,
    }))
    const equipRows = (listAllEquipment(projectId) as any[]).map(mapEquipRow)
    const issueRows = (listIssues({ projectId }) as any[]).map(mapIssueRow)

    return saveSheets(e.sender, `${p.code}_项目汇总_${stamp()}.xlsx`, [
      { name: '项目信息', rows: infoSheet },
      { name: '工序进度', rows: processRows },
      { name: '设备台账', rows: equipRows },
      { name: '问题台账', rows: issueRows },
    ])
  })

  ipcMain.handle('export:process', async (e, projectId: number) => {
    const p = getProject(projectId) as any
    const rows = (listProcess(projectId) as any[]).map((r) => ({
      序号: r.seq_no, 工序名称: r.name, 计划开始: r.plan_start, 计划结束: r.plan_end,
      实际开始: r.actual_start, 实际结束: r.actual_end, 计划总量: r.plan_qty, 完成量: r.done_qty,
      单位: r.qty_unit, 完成率: Math.round((r.ratio ?? 0) * 100) + '%', 权重: r.weight,
      负责人: r.owner, 状态: r.status,
    }))
    return saveSheets(e.sender, `${p.code}_工序进度_${stamp()}.xlsx`, [{ name: '工序进度', rows }])
  })

  ipcMain.handle('export:equipment', async (e, projectId: number) => {
    const p = getProject(projectId) as any
    const rows = (listAllEquipment(projectId) as any[]).map(mapEquipRow)
    return saveSheets(e.sender, `${p.code}_设备台账_${stamp()}.xlsx`, [{ name: '设备台账', rows }])
  })

  ipcMain.handle('export:issue', async (e, projectId: number) => {
    const p = getProject(projectId) as any
    const rows = (listIssues({ projectId }) as any[]).map(mapIssueRow)
    return saveSheets(e.sender, `${p.code}_问题台账_${stamp()}.xlsx`, [{ name: '问题台账', rows }])
  })
}

function mapEquipRow(r: any) {
  return {
    设备名称: r.name, 规格型号: r.model, 设备位号: r.tag_no, 品牌: r.brand, 供货商: r.supplier,
    单位: r.unit, 数量: r.quantity, 单价: r.unit_price, 合同到货日期: r.contract_arrival_date,
    实际到货日期: r.actual_arrival_date, 到货状态: r.arrival_status, 验收状态: r.accept_status,
    存放位置: r.location, 备注: r.remark,
  }
}

function mapIssueRow(r: any) {
  return {
    问题描述: r.description, 严重等级: r.severity, 关联工序: r.process_name, 提出人: r.reporter,
    提出日期: r.report_date, 责任人: r.owner, 要求闭环日期: r.due_date, 状态: r.status,
    处理措施: r.solution, 闭环日期: r.close_date,
  }
}
