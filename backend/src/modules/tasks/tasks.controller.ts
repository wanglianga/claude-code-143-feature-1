import {
  Body, Controller, Get, Param, Post, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard, Roles, RoleGuard } from '../auth/auth.guard';
import { TasksService, CheckInDto } from './tasks.service';

@Controller('api')
@UseGuards(AuthGuard, RoleGuard)
export class TasksController {
  constructor(private tasks: TasksService) {}

  // 任务室：同一任务内聚合派单/考勤/保险/工时/事件/聊天/结算
  @Get('assignments/:id/room')
  room(@Param('id') id: string) {
    return this.tasks.room(Number(id));
  }

  // ---------- 考勤：四重校验 ----------
  @Roles('WORKER')
  @Post('attendance/check-in')
  checkIn(@Req() req: any, @Body() dto: CheckInDto) {
    return this.tasks.checkIn(req.user.sub, dto);
  }

  @Roles('WORKER')
  @Post('attendance/check-out')
  checkOut(@Req() req: any, @Body() dto: CheckInDto) {
    return this.tasks.checkOut(req.user.sub, dto);
  }

  // 现场主管确认（高风险企业岗位系统自动要求第二名负责人复核）
  @Roles('SUPERVISOR', 'ENTERPRISE')
  @Post('attendance/:id/supervisor-confirm')
  confirm(@Param('id') id: string, @Req() req: any) {
    return this.tasks.supervisorConfirm(req.user, Number(id));
  }

  @Roles('SUPERVISOR', 'ENTERPRISE')
  @Post('assignments/:id/no-show')
  noShow(@Param('id') id: string, @Req() req: any) {
    return this.tasks.markNoShow(req.user, Number(id));
  }

  // 现场工作台：主管待确认签到、待处理事件
  @Roles('SUPERVISOR', 'ENTERPRISE')
  @Get('field/board')
  fieldBoard(@Req() req: any) {
    return this.tasks.fieldBoard(req.user.enterpriseId);
  }

  // ---------- 作业过程事件 ----------
  @Roles('WORKER')
  @Post('events')
  report(@Req() req: any, @Body() dto: any) {
    return this.tasks.reportEvent(req.user.sub, dto);
  }

  @Roles('SUPERVISOR', 'ENTERPRISE')
  @Post('events/:id/review')
  reviewEvent(@Param('id') id: string, @Body() dto: { approve: boolean; note?: string }, @Req() req: any) {
    return this.tasks.reviewEvent(req.user, Number(id), !!dto.approve, dto.note);
  }

  // ---------- 到场后临时岗位调换确认 ----------
  @Roles('SUPERVISOR', 'ENTERPRISE')
  @Post('position-changes')
  proposePositionChange(@Req() req: any, @Body() dto: any) {
    return this.tasks.proposePositionChange(req.user, dto);
  }

  @Roles('WORKER')
  @Post('position-changes/:id/respond')
  respondPositionChange(@Param('id') id: string, @Body() dto: { accept: boolean; note?: string }, @Req() req: any) {
    return this.tasks.respondPositionChange(req.user.sub, Number(id), !!dto.accept, dto.note);
  }

  // ---------- 任务内聊天 ----------
  @Post('assignments/:id/messages')
  postMessage(@Param('id') id: string, @Body() dto: { content: string }, @Req() req: any) {
    return this.tasks.postMessage(req.user, Number(id), dto.content);
  }
}
