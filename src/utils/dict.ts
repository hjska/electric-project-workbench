export const PROJECT_STATUS = ['未开工', '施工中', '已竣工', '已暂停', '已取消']
export const ARRIVAL_STATUS = ['未到货', '部分到货', '已到货']
export const ACCEPT_STATUS = ['未验收', '合格', '不合格', '让步接收']
export const PROCESS_STATUS = ['未开始', '进行中', '已完成', '已暂停']
export const UNITS = ['台', '套', '个', '米', '千米', '项', '批', '百分比']
export const WEATHER = ['晴', '多云', '阴', '小雨', '大雨', '雪', '大风']
export const MILESTONE_STATUS = ['未开始', '进行中', '已达成', '已延期']
export const SEVERITY = ['一般', '重要', '紧急']
export const ISSUE_STATUS = ['待处理', '处理中', '已闭环']
export const ATTACH_CATEGORY = ['照片', '图纸', '文档', '其他']
export const REF_TYPES = ['项目', '设备', '工序', '问题']

export const STATUS_COLOR: Record<string, string> = {
  未开工: 'default',
  施工中: 'processing',
  已竣工: 'success',
  已暂停: 'warning',
  已取消: 'error',

  未到货: 'default',
  部分到货: 'warning',
  已到货: 'processing',

  未验收: 'default',
  合格: 'success',
  不合格: 'error',
  让步接收: 'warning',

  未开始: 'default',
  进行中: 'processing',
  已完成: 'success',

  已达成: 'success',
  已延期: 'error',

  一般: 'default',
  重要: 'warning',
  紧急: 'error',

  待处理: 'error',
  处理中: 'processing',
  已闭环: 'success',
}
