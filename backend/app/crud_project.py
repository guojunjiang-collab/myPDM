"""项目管理 - CRUD"""
import uuid
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from fastapi import HTTPException

from app.models import User
from app.models_project import (
    Project, ProjectMember, ProjectTask, ProjectTaskLink, ProjectTaskComment, ProjectTaskDep,
)
from app.schemas_project import (
    ProjectCreate, ProjectEdit, MemberAdd,
    TaskCreate, TaskEdit, TaskMove, TaskReorder, TaskLinkAdd, CommentAdd, DepCreate,
)


def _uuid(v):
    if v is None or v == "":
        return None
    return uuid.UUID(v) if isinstance(v, str) else v


def _iso(d):
    """date -> 'YYYY-MM-DD';None -> None;已是字符串原样返回。"""
    if d is None:
        return None
    return d.isoformat() if hasattr(d, "isoformat") else str(d)


# ════════════════════════ 项目 ════════════════════════
def _next_project_code(db: Session) -> str:
    count = db.query(Project).count()
    return f"PRJ-{count + 1:03d}"


def create_project(db: Session, data: ProjectCreate, owner_id: uuid.UUID) -> Project:
    p = Project(
        code=_next_project_code(db), name=data.name, owner_id=owner_id,
        status=data.status, planned_start=data.planned_start,
        planned_end=data.planned_end, description=data.description,
    )
    db.add(p); db.commit(); db.refresh(p)
    db.add(ProjectMember(project_id=p.id, user_id=owner_id, role_in_project="经理"))
    for uid in (data.member_user_ids or []):
        if _uuid(uid) != owner_id:
            db.add(ProjectMember(project_id=p.id, user_id=_uuid(uid), role_in_project="成员"))
    db.commit()
    return p


def list_projects(db: Session, user: User) -> list:
    q = db.query(Project).filter(Project.deleted_at.is_(None))
    if user.role != "admin":
        member_pids = db.query(ProjectMember.project_id).filter(ProjectMember.user_id == user.id)
        q = q.filter(Project.id.in_(member_pids))
    return q.order_by(Project.created_at.desc()).all()


def get_project(db: Session, project_id: uuid.UUID) -> Project:
    p = db.query(Project).filter(Project.id == project_id, Project.deleted_at.is_(None)).first()
    if not p:
        raise HTTPException(status_code=404, detail="项目不存在")
    return p


def update_project(db: Session, p: Project, data: ProjectEdit) -> Project:
    for field in ("name", "status", "planned_start", "planned_end", "description"):
        val = getattr(data, field)
        if val is not None:
            setattr(p, field, val)
    if data.owner_id is not None:
        p.owner_id = _uuid(data.owner_id)
    db.commit(); db.refresh(p)
    return p


def delete_project(db: Session, p: Project):
    p.deleted_at = datetime.now(timezone.utc)
    db.commit()


# ════════════════════════ 成员 ════════════════════════
def list_members(db: Session, project_id: uuid.UUID) -> list:
    return db.query(ProjectMember).filter(ProjectMember.project_id == project_id).all()


def is_member(db: Session, project_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    return db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id, ProjectMember.user_id == user_id
    ).first() is not None


def add_member(db: Session, project_id: uuid.UUID, data: MemberAdd) -> ProjectMember:
    uid = _uuid(data.user_id)
    if is_member(db, project_id, uid):
        raise HTTPException(status_code=400, detail="该用户已是项目成员")
    m = ProjectMember(project_id=project_id, user_id=uid, role_in_project=data.role_in_project)
    db.add(m); db.commit(); db.refresh(m)
    return m


def remove_member(db: Session, project_id: uuid.UUID, user_id: uuid.UUID):
    db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id, ProjectMember.user_id == user_id
    ).delete()
    db.commit()


# ════════════════════════ 任务 ════════════════════════
def _next_task_code(db: Session, project: Project) -> str:
    count = db.query(ProjectTask).filter(ProjectTask.project_id == project.id).count()
    return f"{project.code}-{count + 1:02d}"


def get_task(db: Session, task_id: uuid.UUID) -> ProjectTask:
    """按 id 取任务，含已软删的(供 delete_task 子树遍历/状态检视用)。"""
    t = db.query(ProjectTask).filter(ProjectTask.id == task_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="任务不存在")
    return t


def get_active_task(db: Session, task_id: uuid.UUID, project_id: uuid.UUID) -> ProjectTask:
    """取未软删的任务。"""
    t = db.query(ProjectTask).filter(
        ProjectTask.id == task_id,
        ProjectTask.project_id == project_id,
        ProjectTask.deleted_at.is_(None),
    ).first()
    if not t:
        raise HTTPException(status_code=404, detail="任务不存在或已删除")
    return t


def get_active_task(db: Session, task_id: uuid.UUID, project_id: uuid.UUID = None) -> ProjectTask:
    """按 id 取未软删的任务；变更类接口应用此函数。
    传入 project_id 时同时校验任务属于该项目(避免跨项目越权)。"""
    q = db.query(ProjectTask).filter(
        ProjectTask.id == task_id, ProjectTask.deleted_at.is_(None)
    )
    if project_id is not None:
        q = q.filter(ProjectTask.project_id == project_id)
    t = q.first()
    if not t:
        raise HTTPException(status_code=404, detail="任务不存在")
    return t


def create_task(db: Session, project: Project, data: TaskCreate) -> ProjectTask:
    parent_id = _uuid(data.parent_id)
    if parent_id:
        get_task(db, parent_id)
    max_sort = db.query(ProjectTask).filter(
        ProjectTask.project_id == project.id,
        ProjectTask.parent_id == parent_id,
        ProjectTask.deleted_at.is_(None),
    ).count()
    t = ProjectTask(
        project_id=project.id, parent_id=parent_id, code=_next_task_code(db, project),
        name=data.name, task_type=data.task_type, assignee_id=_uuid(data.assignee_id),
        status=data.status, priority=data.priority,
        planned_start=data.planned_start, planned_end=data.planned_end,
        actual_start=data.actual_start, actual_end=data.actual_end,
        description=data.description, sort_order=max_sort,
    )
    db.add(t); db.commit(); db.refresh(t)
    return t


def update_task(db: Session, t: ProjectTask, data: TaskEdit) -> ProjectTask:
    for field in ("name", "task_type", "status", "priority", "planned_start",
                  "planned_end", "actual_start", "actual_end", "description"):
        val = getattr(data, field)
        if val is not None:
            setattr(t, field, val)
    if data.assignee_id is not None:
        t.assignee_id = _uuid(data.assignee_id)
    db.commit(); db.refresh(t)
    return t


def update_task_status(db: Session, t: ProjectTask, status: str) -> ProjectTask:
    t.status = status
    db.commit(); db.refresh(t)
    return t


def move_task(db: Session, t: ProjectTask, data: TaskMove) -> ProjectTask:
    if data.parent_id is not None:
        t.parent_id = _uuid(data.parent_id)
    if data.sort_order is not None:
        t.sort_order = data.sort_order
    db.commit(); db.refresh(t)
    return t


def reorder_task(db: Session, project_id: uuid.UUID, data: "TaskReorder") -> dict:
    """将任务移动到新的父节点和位置，自动重排 sort_order。"""
    task = get_active_task(db, _uuid(data.task_id), project_id)
    old_parent_id = task.parent_id
    new_parent_id = _uuid(data.new_parent_id) if data.new_parent_id else None

    if new_parent_id:
        parent = get_active_task(db, new_parent_id, project_id)
        # 防止拖到自己身上
        if new_parent_id == task.id:
            raise HTTPException(status_code=400, detail="不能拖到自己身上")
        # 防止拖到自己的后代身上(循环引用)
        def is_descendant(ancestor_id, node_id):
            children = db.query(ProjectTask).filter(
                ProjectTask.parent_id == ancestor_id, ProjectTask.deleted_at.is_(None)
            ).all()
            for child in children:
                if child.id == node_id:
                    return True
                if is_descendant(child.id, node_id):
                    return True
            return False
        if is_descendant(task.id, new_parent_id):
            raise HTTPException(status_code=400, detail="不能拖到自己的子任务下")

    task.parent_id = new_parent_id
    db.flush()

    # 重新排列目标父节点下所有兄弟
    siblings = db.query(ProjectTask).filter(
        ProjectTask.project_id == project_id,
        ProjectTask.parent_id == new_parent_id,
        ProjectTask.deleted_at.is_(None),
        ProjectTask.id != task.id,
    ).order_by(ProjectTask.sort_order, ProjectTask.created_at).all()

    siblings.insert(min(data.new_sort_order, len(siblings)), task)
    for i, s in enumerate(siblings):
        s.sort_order = i

    # 如果原父节点变了，压缩原父节点的 sort_order
    if old_parent_id != new_parent_id:
        old_siblings = db.query(ProjectTask).filter(
            ProjectTask.project_id == project_id,
            ProjectTask.parent_id == old_parent_id,
            ProjectTask.deleted_at.is_(None),
        ).order_by(ProjectTask.sort_order, ProjectTask.created_at).all()
        for i, s in enumerate(old_siblings):
            s.sort_order = i

    db.commit()
    return {"detail": "已重新排序", "task_id": str(task.id), "parent_id": str(task.parent_id) if task.parent_id else None}


def delete_task(db: Session, t: ProjectTask):
    """软删任务及其整棵子树,并硬删相关依赖。"""
    now = datetime.now(timezone.utc)
    deleted_ids = []
    to_delete = [t.id]
    while to_delete:
        current = to_delete.pop()
        task = db.query(ProjectTask).filter(ProjectTask.id == current).first()
        if task and task.deleted_at is None:
            task.deleted_at = now
            deleted_ids.append(current)
            children = db.query(ProjectTask.id).filter(
                ProjectTask.parent_id == current, ProjectTask.deleted_at.is_(None)
            ).all()
            to_delete.extend([c[0] for c in children])
    if deleted_ids:
        db.query(ProjectTaskDep).filter(
            (ProjectTaskDep.predecessor_id.in_(deleted_ids)) |
            (ProjectTaskDep.successor_id.in_(deleted_ids))
        ).delete(synchronize_session=False)
    db.commit()


def get_task_tree(db: Session, project_id: uuid.UUID) -> list:
    """组装该项目整棵任务树(嵌套 dict)。"""
    tasks = db.query(ProjectTask).filter(
        ProjectTask.project_id == project_id, ProjectTask.deleted_at.is_(None)
    ).order_by(ProjectTask.sort_order, ProjectTask.created_at).all()
    link_counts = {}
    for tid, in db.query(ProjectTaskLink.task_id).all():
        link_counts[tid] = link_counts.get(tid, 0) + 1
    user_names = {u.id: u.real_name for u in db.query(User).all()}

    nodes = {}
    for t in tasks:
        nodes[t.id] = {
            "id": str(t.id), "project_id": str(t.project_id),
            "parent_id": str(t.parent_id) if t.parent_id else None,
            "code": t.code, "name": t.name, "task_type": t.task_type,
            "assignee_id": str(t.assignee_id) if t.assignee_id else None,
            "assignee_name": user_names.get(t.assignee_id) if t.assignee_id else None,
            "status": t.status, "priority": t.priority,
            "planned_start": _iso(t.planned_start), "planned_end": _iso(t.planned_end),
            "actual_start": _iso(t.actual_start), "actual_end": _iso(t.actual_end),
            "sort_order": t.sort_order, "description": t.description,
            "link_count": link_counts.get(t.id, 0),
            "children": [],
        }
    roots = []
    for t in tasks:
        node = nodes[t.id]
        if t.parent_id and t.parent_id in nodes:
            nodes[t.parent_id]["children"].append(node)
        else:
            roots.append(node)
    return roots


# ════════════════════════ 任务关联对象 ════════════════════════
def add_link(db: Session, task_id: uuid.UUID, data: TaskLinkAdd) -> ProjectTaskLink:
    link = ProjectTaskLink(task_id=task_id, entity_type=data.entity_type, entity_id=_uuid(data.entity_id))
    db.add(link); db.commit(); db.refresh(link)
    return link


def list_links(db: Session, task_id: uuid.UUID) -> list:
    return db.query(ProjectTaskLink).filter(ProjectTaskLink.task_id == task_id).all()


def remove_link(db: Session, link_id: uuid.UUID):
    db.query(ProjectTaskLink).filter(ProjectTaskLink.id == link_id).delete()
    db.commit()


def get_link(db: Session, link_id: uuid.UUID) -> ProjectTaskLink:
    link = db.query(ProjectTaskLink).filter(ProjectTaskLink.id == link_id).first()
    if not link:
        raise HTTPException(status_code=404, detail="关联不存在")
    return link


# ════════════════════════ 任务评论 ════════════════════════
def add_comment(db: Session, task_id: uuid.UUID, user_id: uuid.UUID, data: CommentAdd) -> ProjectTaskComment:
    c = ProjectTaskComment(task_id=task_id, user_id=user_id, content=data.content)
    db.add(c); db.commit(); db.refresh(c)
    return c


def list_comments(db: Session, task_id: uuid.UUID) -> list:
    return db.query(ProjectTaskComment).filter(
        ProjectTaskComment.task_id == task_id, ProjectTaskComment.deleted_at.is_(None)
    ).order_by(ProjectTaskComment.created_at).all()


def get_comment(db: Session, comment_id: uuid.UUID) -> ProjectTaskComment:
    c = db.query(ProjectTaskComment).filter(
        ProjectTaskComment.id == comment_id, ProjectTaskComment.deleted_at.is_(None)
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="评论不存在")
    return c


def delete_comment(db: Session, c: ProjectTaskComment):
    c.deleted_at = datetime.now(timezone.utc)
    db.commit()


# ════════════════════════ 任务依赖 ════════════════════════
def list_deps(db: Session, project_id: uuid.UUID) -> list:
    return db.query(ProjectTaskDep).filter(ProjectTaskDep.project_id == project_id).all()


def _would_create_cycle(db: Session, project_id: uuid.UUID, pred_id, succ_id) -> bool:
    """加入 pred->succ 后是否成环:即 succ 是否已能到达 pred。"""
    edges = {}
    for d in list_deps(db, project_id):
        edges.setdefault(d.predecessor_id, []).append(d.successor_id)
    edges.setdefault(pred_id, []).append(succ_id)
    stack = [succ_id]; seen = set()
    while stack:
        cur = stack.pop()
        if cur == pred_id:
            return True
        if cur in seen:
            continue
        seen.add(cur)
        stack.extend(edges.get(cur, []))
    return False


def add_dep(db: Session, project_id: uuid.UUID, data: DepCreate) -> ProjectTaskDep:
    pred = _uuid(data.predecessor_id); succ = _uuid(data.successor_id)
    if pred == succ:
        raise HTTPException(status_code=400, detail="任务不能依赖自身")
    for tid in (pred, succ):
        t = db.query(ProjectTask).filter(
            ProjectTask.id == tid, ProjectTask.project_id == project_id,
            ProjectTask.deleted_at.is_(None)
        ).first()
        if not t:
            raise HTTPException(status_code=404, detail="任务不存在或不属于该项目")
    exists = db.query(ProjectTaskDep).filter(
        ProjectTaskDep.predecessor_id == pred, ProjectTaskDep.successor_id == succ
    ).first()
    if exists:
        raise HTTPException(status_code=400, detail="该依赖已存在")
    if _would_create_cycle(db, project_id, pred, succ):
        raise HTTPException(status_code=400, detail="依赖会形成循环")
    d = ProjectTaskDep(project_id=project_id, predecessor_id=pred, successor_id=succ,
                       dep_type=data.dep_type, lag_days=data.lag_days)
    db.add(d); db.commit(); db.refresh(d)
    return d


def remove_dep(db: Session, project_id: uuid.UUID, dep_id: uuid.UUID):
    db.query(ProjectTaskDep).filter(
        ProjectTaskDep.id == dep_id, ProjectTaskDep.project_id == project_id
    ).delete()
    db.commit()


# ════════════════════════ 甘特 / CPM ════════════════════════
def _leaf_ids(tasks) -> set:
    parents = {t.parent_id for t in tasks if t.parent_id is not None}
    return {t.id for t in tasks if t.id not in parents}


def _es_lower_bound(dep_type, es_pred, ef_pred, dur_succ, lag) -> int:
    """该依赖对 succ 最早开始(ES,天序号)施加的下界。"""
    if dep_type == "SS":
        return es_pred + lag
    if dep_type == "FF":
        return ef_pred + lag - dur_succ + 1
    if dep_type == "SF":
        return es_pred + lag - dur_succ + 1
    return ef_pred + 1 + lag  # FS(默认)


def _lf_upper_bound(dep_type, ls_succ, lf_succ, dur_pred, lag) -> int:
    """该依赖对 pred 最晚完成(LF,天序号)施加的上界。"""
    if dep_type == "SS":
        return ls_succ - lag + dur_pred - 1
    if dep_type == "FF":
        return lf_succ - lag
    if dep_type == "SF":
        return lf_succ - lag + dur_pred - 1
    return ls_succ - 1 - lag  # FS(默认)


def compute_schedule(db: Session, project_id: uuid.UUID, tasks=None, deps=None) -> set:
    """经典 CPM:仅对有完整计划日期的叶任务,按依赖+工期算 slack。
    采用闭区间天序号(EF = ES + 工期 - 1),前后向约束一致。
    返回关键路径任务 id 集合(slack==0)。无法计算时返回空集。"""
    if tasks is None:
        tasks = db.query(ProjectTask).filter(
            ProjectTask.project_id == project_id, ProjectTask.deleted_at.is_(None)
        ).all()
    if deps is None:
        deps = list_deps(db, project_id)
    leaves = _leaf_ids(tasks)
    dur = {}
    for t in tasks:
        if t.id in leaves and t.planned_start and t.planned_end:
            dur[t.id] = (t.planned_end - t.planned_start).days + 1
    if not dur:
        return set()
    edges = [(d.predecessor_id, d.successor_id, d.dep_type, d.lag_days)
             for d in deps if d.predecessor_id in dur and d.successor_id in dur]
    succ_map = {}; pred_map = {}; indeg = {tid: 0 for tid in dur}
    for pr, su, ty, lg in edges:
        succ_map.setdefault(pr, []).append((su, ty, lg))
        pred_map.setdefault(su, []).append((pr, ty, lg))
        indeg[su] += 1
    topo = []; queue = [tid for tid in dur if indeg[tid] == 0]
    indeg2 = dict(indeg)
    while queue:
        n = queue.pop(0); topo.append(n)
        for su, ty, lg in succ_map.get(n, []):
            indeg2[su] -= 1
            if indeg2[su] == 0:
                queue.append(su)
    if len(topo) != len(dur):
        return set()
    ES = {}; EF = {}
    for n in topo:
        es = 0
        for pr, ty, lg in pred_map.get(n, []):
            es = max(es, _es_lower_bound(ty, ES[pr], EF[pr], dur[n], lg))
        ES[n] = es; EF[n] = es + dur[n] - 1
    project_end = max(EF.values())
    LF = {}; LS = {}
    for n in reversed(topo):
        succs = succ_map.get(n, [])
        if not succs:
            lf = project_end
        else:
            lf = min(_lf_upper_bound(ty, LS[su], LF[su], dur[n], lg)
                     for su, ty, lg in succs)
        LF[n] = lf; LS[n] = lf - dur[n] + 1
    return {n for n in dur if (LS[n] - ES[n]) == 0}


def _violation(dep, tasks_by_id) -> bool:
    """以实际计划日期(天序号)判断该依赖是否被违反(供前端红色提示)。"""
    pr = tasks_by_id.get(dep.predecessor_id); su = tasks_by_id.get(dep.successor_id)
    if not pr or not su:
        return False
    if not (pr.planned_start and pr.planned_end and su.planned_start and su.planned_end):
        return False
    ps = pr.planned_start.toordinal(); pe = pr.planned_end.toordinal()
    ss = su.planned_start.toordinal(); se = su.planned_end.toordinal()
    lag = dep.lag_days
    if dep.dep_type == "SS":
        return ss < ps + lag
    if dep.dep_type == "FF":
        return se < pe + lag
    if dep.dep_type == "SF":
        return se < ps + lag
    return ss < pe + 1 + lag  # FS(默认)


def get_gantt_data(db: Session, project_id: uuid.UUID) -> dict:
    tasks = db.query(ProjectTask).filter(
        ProjectTask.project_id == project_id, ProjectTask.deleted_at.is_(None)
    ).order_by(ProjectTask.sort_order, ProjectTask.created_at).all()
    deps = list_deps(db, project_id)
    critical = compute_schedule(db, project_id, tasks, deps)
    user_names = {u.id: u.real_name for u in db.query(User).all()}
    tasks_by_id = {t.id: t for t in tasks}

    # 与详情树同序:tasks 已按 (sort_order, created_at) 排序;按兄弟序做 DFS 前序遍历,
    # 保证甘特行序与父子缩进和"项目详情"树完全一致(扁平全局 sort_order 会把不同父级的子任务交错)。
    children = {}
    roots = []
    for t in tasks:
        if t.parent_id and t.parent_id in tasks_by_id:
            children.setdefault(t.parent_id, []).append(t)
        else:
            roots.append(t)

    today = datetime.now(timezone.utc).date()
    out_tasks = []
    dates = []

    def _emit(t, depth):
        ps, pe = t.planned_start, t.planned_end
        if ps:
            dates.append(ps)
        if pe:
            dates.append(pe)
        is_overdue = bool(pe and pe < today and t.status != "已完成")
        out_tasks.append({
            "id": str(t.id), "parent_id": str(t.parent_id) if t.parent_id else None,
            "code": t.code, "name": t.name, "task_type": t.task_type, "status": t.status,
            "assignee_name": user_names.get(t.assignee_id) if t.assignee_id else None,
            "planned_start": _iso(ps), "planned_end": _iso(pe),
            "duration_days": ((pe - ps).days + 1) if (ps and pe) else None,
            "is_critical": t.id in critical, "is_overdue": is_overdue,
            "sort_order": t.sort_order, "depth": depth,
        })
        for c in children.get(t.id, []):
            _emit(c, depth + 1)

    for r in roots:
        _emit(r, 0)
    out_deps = [{
        "id": str(d.id), "predecessor_id": str(d.predecessor_id),
        "successor_id": str(d.successor_id), "dep_type": d.dep_type,
        "lag_days": d.lag_days, "is_violation": _violation(d, tasks_by_id),
    } for d in deps]
    return {
        "tasks": out_tasks, "deps": out_deps,
        "range": {"min_date": _iso(min(dates)) if dates else None,
                  "max_date": _iso(max(dates)) if dates else None},
    }
