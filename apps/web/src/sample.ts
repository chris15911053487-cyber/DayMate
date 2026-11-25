/** M0 演示用的示例数据（M2 起换成真实接口） */
export interface SampleEvent {
  time: string
  end?: string
  title: string
  where?: string
  tone: 'primary' | 'accent' | 'success'
  remind?: boolean
  done?: boolean
}

export const sampleBrief =
  '今天 4 个安排，下午 15:00–17:00 最满，中午记得留出路上的时间。昨天的「季度报告提纲」还没完成，建议上午先做 30 分钟。'

export const sampleEvents: SampleEvent[] = [
  { time: '09:00', end: '09:30', title: '团队周会', where: '3 楼会议室', tone: 'accent', done: true },
  { time: '12:30', end: '13:30', title: '和小林吃午饭', where: '公司楼下', tone: 'success' },
  { time: '15:00', end: '16:00', title: '和老王开会', where: '国贸', tone: 'primary', remind: true },
  { time: '19:30', end: '20:30', title: '健身', where: '小区健身房', tone: 'success' },
]

export const sampleTasks = [
  { title: '季度报告提纲', due: '今天', done: false },
  { title: '给妈妈打电话', due: '今天', done: false },
  { title: '续交物业费', due: '周五', done: true },
]

export const sampleEntries = [
  { time: '09:35', text: '周会定了：下周三前把新版排期给到产品。', voice: true },
  { time: '11:10', text: '读完《深度工作》第三章，"拒绝浅薄"那段值得再看一遍。', voice: false },
]
