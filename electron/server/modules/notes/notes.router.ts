import { Router } from 'express'
import { AppDataSource } from '../../data-source'
import { UserConfig } from '../../entities/UserConfig'
import { authRequired, AuthedRequest } from '../../middleware/auth'
import { asyncHandler, HttpError } from '../../middleware/error'
import { applyWorkDir } from '../../index'

const router = Router()
router.use(authRequired)

// 工作目录：仅保存路径到 user_config；实际目录操作走 preload IPC
router.get('/work-dir', asyncHandler(async (req: AuthedRequest, res) => {
  const repo = AppDataSource.getRepository(UserConfig)
  const cfg = await repo.findOne({ where: { userId: req.user!.id } })
  const dir = cfg?.workDir ?? null
  applyWorkDir(dir ?? undefined)
  res.json({ workDir: dir })
}))

router.put('/work-dir', asyncHandler(async (req: AuthedRequest, res) => {
  const { workDir } = req.body || {}
  if (!workDir || typeof workDir !== 'string') throw new HttpError(400, 'INVALID_INPUT', 'workDir 必填')
  const repo = AppDataSource.getRepository(UserConfig)
  let cfg = await repo.findOne({ where: { userId: req.user!.id } })
  if (!cfg) {
    cfg = repo.create({ userId: req.user!.id, themeDefault: 'light', themeFollowTime: true, langDefault: 'zh' })
  }
  cfg.workDir = workDir
  await repo.save(cfg)
  applyWorkDir(workDir)
  res.json({ ok: true })
}))

export { router as notesRouter }
