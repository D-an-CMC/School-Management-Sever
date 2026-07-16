import { Router } from 'express';
import authRoutes from './auth.routes';
import usersRoutes from './users.routes';
import studentsRoutes from './students.routes';
import teachersRoutes from './teachers.routes';
import classesRoutes from './classes.routes';
import schoolYearsRoutes from './school-years.routes';
import gradesRoutes from './grades.routes';
import attendanceRoutes from './attendance.routes';
import timetableRoutes from './timetable.routes';
import aiRoutes from './ai.routes';
import notificationsRoutes from './notifications.routes';
import permissionsRoutes from './permissions.routes';
import activitiesRoutes from './activities.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/students', studentsRoutes);
router.use('/teachers', teachersRoutes);
router.use('/classes', classesRoutes);
router.use('/school-years', schoolYearsRoutes);
router.use('/grades', gradesRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/timetables', timetableRoutes);
router.use('/ai', aiRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/permissions', permissionsRoutes);
router.use('/activities', activitiesRoutes);

export default router;
