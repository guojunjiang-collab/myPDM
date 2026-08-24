"""图文档签入检出 CRUD（三层模型：Master → Revision → Iteration）"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional, Tuple, List, Dict, Any
from uuid import UUID
import os
import shutil

from sqlalchemy.orm import Session
from sqlalchemy import text

from . import models
from . import crud as crud_common
from .file_storage import file_storage


VERSION_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"


def _to_version_string(index: int) -> str:
    """将索引转为版本字符串 A=0, B=1, ...（24进制，不含I/O）"""
    if index < 0:
        index = 0
    result = ""
    num = index
    while True:
        result = VERSION_CHARS[num % 24] + result
        num = num // 24 - 1
        if num < 0:
            break
    return result


def _get_next_version(db: Session, master_id: UUID) -> str:
    """根据同一 master 下已有版本数，生成下一版本号"""
    count = (
        db.query(models.DocumentRevision)
        .filter(
            models.DocumentRevision.master_id == master_id,
            models.DocumentRevision.deleted_at.is_(None),
        )
        .count()
    )
    return _to_version_string(count)


# ====== 迭代辅助 ======

def _get_current_iteration(db: Session, revision_id: UUID) -> Optional[models.DocumentIteration]:
    """获取版本的最新迭代"""
    revision = (
        db.query(models.DocumentRevision)
        .filter(
            models.DocumentRevision.id == revision_id,
            models.DocumentRevision.deleted_at.is_(None),
        )
        .first()
    )
    if not revision or revision.latest_iteration == 0:
        return None
    return (
        db.query(models.DocumentIteration)
        .filter(
            models.DocumentIteration.revision_id == revision_id,
            models.DocumentIteration.iteration == revision.latest_iteration,
        )
        .first()
    )


# ====== 迭代数据复制（签出/升版时调用） ======

def _copy_attachments_to_iteration(
    db: Session,
    source_iter: models.DocumentIteration,
    target_iter: models.DocumentIteration,
):
    """复制上一迭代的附件引用和物理文件到新迭代"""
    source_atts = source_iter.attachments.all()
    for att in source_atts:
        new_path = att.file_path
        if att.file_path:
            try:
                old_full = file_storage._safe_resolve(att.file_path)
                if old_full.exists():
                    revision = target_iter.revision
                    master = revision.master
                    new_rel_path = (
                        f"document/{master.code}/{revision.version}"
                        f"/{target_iter.iteration}/{att.file_name}"
                    )
                    new_full = file_storage._safe_resolve(new_rel_path)
                    new_full.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(str(old_full), str(new_full))
                    new_path = new_rel_path
            except Exception:
                pass

        new_att = models.DocumentAttachment(
            revision_id=target_iter.revision_id,
            iteration_id=target_iter.id,
            file_name=att.file_name,
            file_size=att.file_size,
            file_path=new_path,
            file_hash=att.file_hash,
        )
        db.add(new_att)


# ====== DocumentMaster CRUD ======

def create_document(
    db: Session, data: dict, user_id: UUID
) -> models.DocumentMaster:
    """创建文档：同时创建 Master + Revision(A=draft) + Iteration(1)，自动签出"""
    code = data["code"]
    existing = (
        db.query(models.DocumentMaster)
        .filter(
            models.DocumentMaster.code == code,
            models.DocumentMaster.deleted_at.is_(None),
        )
        .first()
    )
    if existing:
        has_rev = (
            db.query(models.DocumentRevision)
            .filter(
                models.DocumentRevision.master_id == existing.id,
                models.DocumentRevision.deleted_at.is_(None),
            )
            .count()
        )
        if has_rev > 0:
            raise ValueError(f"文档编码「{code}」已存在")

    master = models.DocumentMaster(
        code=code,
        name=data["name"],
    )
    db.add(master)
    db.flush()

    revision = models.DocumentRevision(
        master_id=master.id,
        version="A",
        status="draft",
        latest_iteration=1,
        check_out_user_id=user_id,
        check_out_date=datetime.now(timezone.utc),
    )
    db.add(revision)
    db.flush()

    iteration = models.DocumentIteration(
        revision_id=revision.id,
        iteration=1,
        creator_id=user_id,
    )
    db.add(iteration)
    db.commit()
    db.refresh(master)
    return master


def get_document_master(db: Session, master_id: UUID) -> Optional[models.DocumentMaster]:
    return (
        db.query(models.DocumentMaster)
        .filter(
            models.DocumentMaster.id == master_id,
            models.DocumentMaster.deleted_at.is_(None),
        )
        .first()
    )


def get_document_master_by_code(db: Session, code: str) -> Optional[models.DocumentMaster]:
    return (
        db.query(models.DocumentMaster)
        .filter(
            models.DocumentMaster.code == code,
            models.DocumentMaster.deleted_at.is_(None),
        )
        .first()
    )


def update_document_master(
    db: Session, master_id: UUID, data: dict
) -> Optional[models.DocumentMaster]:
    """更新主数据字段（code / name）"""
    master = get_document_master(db, master_id)
    if not master:
        return None
    for field in ("code", "name"):
        if field in data and data[field] is not None:
            setattr(master, field, data[field])
    db.commit()
    db.refresh(master)
    return master


# ====== DocumentRevision CRUD ======

def get_document_revision(
    db: Session, revision_id: UUID
) -> Optional[models.DocumentRevision]:
    return (
        db.query(models.DocumentRevision)
        .filter(
            models.DocumentRevision.id == revision_id,
            models.DocumentRevision.deleted_at.is_(None),
        )
        .first()
    )


def get_document_revision_with_current_iteration(
    db: Session, revision_id: UUID
) -> Optional[Tuple[models.DocumentRevision, Optional[models.DocumentIteration]]]:
    """获取版本 + 当前最新迭代"""
    revision = get_document_revision(db, revision_id)
    if not revision:
        return None
    iteration = _get_current_iteration(db, revision_id)
    return revision, iteration


def list_revisions_by_master(
    db: Session, master_id: UUID
) -> List[models.DocumentRevision]:
    return (
        db.query(models.DocumentRevision)
        .filter(
            models.DocumentRevision.master_id == master_id,
            models.DocumentRevision.deleted_at.is_(None),
        )
        .order_by(models.DocumentRevision.created_at)
        .all()
    )


# ====== 签出 ======

def checkout_document(
    db: Session, revision_id: UUID, user_id: UUID
) -> Tuple[Optional[models.DocumentRevision], Optional[str]]:
    """签出文档：创建新迭代(+1)，复制上一迭代附件和自定义字段，设置签出锁"""
    revision = get_document_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.status not in ("draft",):
        return None, "仅草稿状态可签出"
    if revision.check_out_user_id is not None:
        return None, "该版本已被他人签出"

    prev_iter = _get_current_iteration(db, revision_id)
    new_iter_num = revision.latest_iteration + 1
    new_iter = models.DocumentIteration(
        revision_id=revision_id,
        iteration=new_iter_num,
        creator_id=user_id,
    )
    db.add(new_iter)
    db.flush()

    if prev_iter:
        _copy_attachments_to_iteration(db, prev_iter, new_iter)
        crud_common._copy_iteration_custom_fields(db, prev_iter.id, new_iter.id, source_entity_id=revision_id)

    revision.latest_iteration = new_iter_num
    revision.check_out_user_id = user_id
    revision.check_out_date = datetime.now(timezone.utc)
    db.commit()
    db.refresh(revision)
    return revision, None


# ====== 签入 ======

def checkin_document(
    db: Session, revision_id: UUID, user_id: UUID, note: Optional[str] = None
) -> Tuple[Optional[models.DocumentRevision], Optional[str]]:
    """签入文档：记录签入说明，清除签出锁"""
    revision = get_document_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.check_out_user_id is None:
        return None, "该版本未被签出"
    if str(revision.check_out_user_id) != str(user_id):
        return None, "只有签出者本人才能签入"

    iteration = _get_current_iteration(db, revision_id)
    if iteration:
        iteration.check_in_date = datetime.now(timezone.utc)
        iteration.check_in_note = note

    revision.check_out_user_id = None
    revision.check_out_date = None
    db.commit()
    db.refresh(revision)
    return revision, None


# ====== 撤销签出 ======

def undocheckout_document(
    db: Session, revision_id: UUID, user_id: UUID
) -> Tuple[Optional[models.DocumentRevision], Optional[str]]:
    """撤销签出：删除最新迭代及附件，回退 latest_iteration，清除签出锁"""
    revision = get_document_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.check_out_user_id is None:
        return None, "该版本未被签出"
    if str(revision.check_out_user_id) != str(user_id):
        return None, "只有签出者本人才能撤销签出"
    if revision.latest_iteration <= 1:
        return None, "至少需保留一个迭代"

    latest_iter = (
        db.query(models.DocumentIteration)
        .filter(
            models.DocumentIteration.revision_id == revision_id,
            models.DocumentIteration.iteration == revision.latest_iteration,
        )
        .first()
    )
    if latest_iter:
        atts = latest_iter.attachments.all()
        for att in atts:
            if att.file_path:
                try:
                    file_storage.delete_file(att.file_path)
                except Exception:
                    pass
            # 同步清理预览缓存（glb/pdf）
            try:
                from .office_converter import delete_pdf_cache, is_office_file
                from .stp_converter import delete_glb_cache, is_stp_file
                if is_stp_file(att.file_name):
                    delete_glb_cache(str(att.id), att.file_path)
                if is_office_file(att.file_name):
                    delete_pdf_cache(str(att.id), att.file_path)
            except Exception:
                pass
            db.delete(att)
        db.query(models.CustomFieldValue).filter(
            models.CustomFieldValue.iteration_id == latest_iter.id
        ).delete(synchronize_session=False)
        db.delete(latest_iter)

    revision.latest_iteration -= 1
    revision.check_out_user_id = None
    revision.check_out_date = None
    db.commit()
    db.refresh(revision)
    return revision, None


# ====== 强制签入（管理员） ======

def force_checkin_document(
    db: Session, revision_id: UUID
) -> Tuple[Optional[models.DocumentRevision], Optional[str]]:
    """管理员强制签入：清除签出锁，保留当前迭代"""
    revision = get_document_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.check_out_user_id is None:
        return None, "该版本未被签出"

    revision.check_out_user_id = None
    revision.check_out_date = None
    db.commit()
    db.refresh(revision)
    return revision, None


# ====== 升版 ======

def upgrade_document(
    db: Session, revision_id: UUID, user_id: UUID
) -> Tuple[Optional[models.DocumentRevision], Optional[str]]:
    """升版：创建新版本（B/C/...），复制附件和自定义字段，自动签出"""
    source_rev = get_document_revision(db, revision_id)
    if not source_rev:
        return None, "源版本不存在"
    if source_rev.status not in ("released", "obsolete"):
        return None, "仅已发布或已作废版本可升版"

    source_iter = _get_current_iteration(db, revision_id)

    new_version = _get_next_version(db, source_rev.master_id)
    new_rev = models.DocumentRevision(
        master_id=source_rev.master_id,
        version=new_version,
        status="draft",
        latest_iteration=1,
        revision_parent_id=source_rev.id,
    )
    db.add(new_rev)
    db.flush()

    new_iter = models.DocumentIteration(
        revision_id=new_rev.id,
        iteration=1,
        creator_id=user_id,
    )
    db.add(new_iter)
    db.flush()

    if source_iter:
        _copy_attachments_to_iteration(db, source_iter, new_iter)
        # 复制自定义字段值到新版本
        crud_common._copy_iteration_custom_fields(db, source_iter.id, new_iter.id, new_entity_id=new_rev.id, source_entity_id=source_rev.id)

    new_rev.check_out_user_id = user_id
    new_rev.check_out_date = datetime.now(timezone.utc)
    db.commit()
    db.refresh(new_rev)
    return new_rev, None


# ====== 状态变更 ======

def freeze_document(
    db: Session, revision_id: UUID
) -> Tuple[Optional[models.DocumentRevision], Optional[str]]:
    """冻结文档版本：draft → frozen"""
    revision = get_document_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.status != "draft":
        return None, "仅草稿状态可冻结"
    if revision.check_out_user_id is not None:
        return None, "版本被签出，请先签入后再冻结"
    revision.status = "frozen"
    db.commit()
    db.refresh(revision)
    return revision, None


def unfreeze_document(
    db: Session, revision_id: UUID
) -> Tuple[Optional[models.DocumentRevision], Optional[str]]:
    """解冻文档版本：frozen → draft"""
    revision = get_document_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.status != "frozen":
        return None, "仅冻结状态可解冻"
    revision.status = "draft"
    db.commit()
    db.refresh(revision)
    return revision, None


def release_document(
    db: Session, revision_id: UUID
) -> Tuple[Optional[models.DocumentRevision], Optional[str]]:
    """发布文档版本：draft / frozen → released"""
    revision = get_document_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.status not in ("draft", "frozen"):
        return None, "仅草稿或冻结状态可发布"
    if revision.check_out_user_id is not None:
        return None, "版本被签出，请先签入后再发布"
    revision.status = "released"
    db.commit()
    db.refresh(revision)
    return revision, None


def obsolete_document(
    db: Session, revision_id: UUID
) -> Tuple[Optional[models.DocumentRevision], Optional[str]]:
    """作废文档版本：released → obsolete"""
    revision = get_document_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.status != "released":
        return None, "仅已发布状态可作废"
    revision.status = "obsolete"
    db.commit()
    db.refresh(revision)
    return revision, None


# ====== 删除版本 ======

def delete_document_revision(db: Session, revision_id: UUID) -> bool:
    """软删除版本（级联软删除所有迭代）"""
    revision = get_document_revision(db, revision_id)
    if not revision:
        return False
    revision.deleted_at = datetime.now(timezone.utc)
    db.query(models.DocumentIteration).filter(
        models.DocumentIteration.revision_id == revision_id
    ).update({"deleted_at": datetime.now(timezone.utc)})
    db.commit()
    return True


# ====== 列表查询 ======

SORT_FIELDS_DOCS = {'code', 'name', 'created_at', 'version', 'status', 'check_out_user_name'}
SORT_ORDERS = {'asc', 'desc'}
SEARCH_FIELDS_DOCS = {'all', 'code', 'name', 'remark'}


def list_documents(
    db: Session,
    search: Optional[str] = None,
    status: Optional[str] = None,
    show_all_versions: bool = False,
    page: int = 1,
    page_size: int = 50,
    sort_field: str = 'code',
    sort_order: str = 'asc',
    search_field: str = 'all',
    include_custom_fields: bool = False,
    show_accessible_only: bool = False,
    current_user_id: Optional[UUID] = None,
) -> Tuple[List[Dict], int]:
    """按 revision 维度分页，支持服务端排序、搜索与附件信息，返回 (items, total)。"""

    if sort_field not in SORT_FIELDS_DOCS:
        raise ValueError(f"Invalid sort_field: {sort_field}")
    if sort_order not in SORT_ORDERS:
        raise ValueError(f"Invalid sort_order: {sort_order}")
    if search_field not in SEARCH_FIELDS_DOCS:
        raise ValueError(f"Invalid search_field: {search_field}")
    page = max(1, page)
    page_size = max(1, page_size)

    order_col_map = {
        'code': 'code',
        'name': 'name',
        'created_at': 'created_at',
        'version': 'version_to_int(version)',
        'status': 'status',
        'check_out_user_name': 'check_out_user_name',
    }
    order_col = order_col_map[sort_field]
    order_dir = 'DESC' if sort_order == 'desc' else 'ASC'
    nulls = 'NULLS LAST' if sort_order == 'asc' else 'NULLS FIRST'

    search_clauses = []
    search_params = {}
    if search:
        like = f"%%{search}%%"
        search_params['like'] = like
        if search_field in ('all', 'code'):
            search_clauses.append("m.code ILIKE :like")
        if search_field in ('all', 'name'):
            search_clauses.append("m.name ILIKE :like")
        if search_field == 'remark':
            rev_alias_s = 'r' if show_all_versions else 'latest_r'
            search_clauses.append(f"{rev_alias_s}.remark ILIKE :like")
        if search_field == 'all':
            rev_alias_sa = 'r' if show_all_versions else 'latest_r'
            search_clauses.append(f"{rev_alias_sa}.remark ILIKE :like")
        if include_custom_fields:
            rev_alias_cf = 'r' if show_all_versions else 'latest_r'
            search_clauses.append(f"""
                EXISTS (
                    SELECT 1 FROM custom_field_values cfv
                    WHERE cfv.entity_type = 'document' AND cfv.entity_id = {rev_alias_cf}.id
                      AND COALESCE(cfv.value_text,
                                   to_char(cfv.value_number, 'FM999999999990.0000'),
                                   cfv.value_json::text) ILIKE :like
                )
            """)
    where_search = ""
    if search_clauses:
        where_search = "AND (" + " OR ".join(search_clauses) + ")"

    rev_alias_filter = 'r' if show_all_versions else 'latest_r'

    where_status = ""
    status_params = {}
    if status:
        where_status = f"AND {rev_alias_filter}.status = :status"
        status_params = {'status': status}

    where_accessible = ""
    acc_params = {}
    if show_accessible_only and current_user_id:
        where_accessible = f"""
            AND (
                EXISTS (
                    SELECT 1 FROM document_group_links dgl
                    JOIN user_group_members ugm ON ugm.group_id = dgl.group_id
                    WHERE dgl.document_id = m.id AND ugm.user_id = :current_user_id
                )
                OR EXISTS (
                    SELECT 1 FROM document_iterations di
                    JOIN document_revisions dr2 ON dr2.id = di.revision_id
                    WHERE dr2.master_id = m.id AND di.creator_id = :current_user_id
                )
            )
        """
        acc_params = {'current_user_id': current_user_id}

    version_col = 'r.version' if show_all_versions else 'latest_r.version'
    status_col = 'r.status' if show_all_versions else 'latest_r.status'
    check_out_user_id_col = 'r.check_out_user_id' if show_all_versions else 'latest_r.check_out_user_id'
    check_out_date_col = 'r.check_out_date' if show_all_versions else 'latest_r.check_out_date'
    latest_iter_col = 'r.latest_iteration' if show_all_versions else 'latest_r.latest_iteration'
    rev_id_col = 'r.id' if show_all_versions else 'latest_r.id'
    remark_col = 'r.remark' if show_all_versions else 'latest_r.remark'

    base_where = "WHERE m.deleted_at IS NULL"

    if show_all_versions:
        sql_count = f"""
            SELECT COUNT(*) FROM document_masters m
            JOIN document_revisions r ON r.master_id = m.id AND r.deleted_at IS NULL
            {base_where} {where_search} {where_status} {where_accessible}
        """
        sql_items = f"""
            WITH ranked AS (
                SELECT
                    {rev_id_col} AS revision_id, r.master_id, m.code, m.name,
                    {version_col} AS version, {status_col} AS status,
                    r.created_at, m.created_at AS master_created_at, m.updated_at AS master_updated_at,
                    {check_out_user_id_col} AS check_out_user_id,
                    co_user.real_name AS check_out_user_name,
                    {check_out_date_col} AS check_out_date,
                    {latest_iter_col} AS latest_iteration,
                    {remark_col} AS remark,
                    COALESCE(v_cnt.cnt, 0) AS version_count,
                    COALESCE(it_cnt.cnt, 0) AS iteration_count,
                    att.file_name, att.id AS file_id, att.file_size
                FROM document_masters m
                JOIN document_revisions r ON r.master_id = m.id AND r.deleted_at IS NULL
                LEFT JOIN users co_user ON co_user.id = {check_out_user_id_col}
                LEFT JOIN (
                    SELECT master_id, COUNT(*) AS cnt FROM document_revisions WHERE deleted_at IS NULL GROUP BY master_id
                ) v_cnt ON v_cnt.master_id = m.id
                LEFT JOIN (
                    SELECT revision_id, COUNT(*) AS cnt FROM document_iterations GROUP BY revision_id
                ) it_cnt ON it_cnt.revision_id = r.id
                LEFT JOIN LATERAL (
                    SELECT da.file_name, da.id, da.file_size
                    FROM document_iterations di_att
                    JOIN document_attachments da ON da.iteration_id = di_att.id
                    WHERE di_att.revision_id = r.id AND di_att.iteration = r.latest_iteration
                    ORDER BY da.created_at LIMIT 1
                ) att ON TRUE
                {base_where} {where_search} {where_status} {where_accessible}
            )
            SELECT * FROM ranked
            ORDER BY {order_col} {order_dir} {nulls}
            LIMIT :limit OFFSET :offset
        """
    else:
        sql_count = f"""
            SELECT COUNT(*) FROM document_masters m
            JOIN LATERAL (
            SELECT r.* FROM document_revisions r
            WHERE r.master_id = m.id AND r.deleted_at IS NULL
            ORDER BY version_to_int(r.version) DESC LIMIT 1
            ) latest_r ON TRUE
            {base_where} {where_search} {where_status} {where_accessible}
        """
        sql_items = f"""
            WITH ranked AS (
                SELECT
                    latest_r.id AS revision_id, latest_r.master_id, m.code, m.name,
                    latest_r.version, latest_r.status,
                    latest_r.created_at, m.created_at AS master_created_at, m.updated_at AS master_updated_at,
                    latest_r.check_out_user_id,
                    co_user.real_name AS check_out_user_name,
                    latest_r.check_out_date,
                    latest_r.latest_iteration,
                    latest_r.remark,
                    COALESCE(v_cnt.cnt, 0) AS version_count,
                    COALESCE(it_cnt.cnt, 0) AS iteration_count,
                    att.file_name, att.id AS file_id, att.file_size
                FROM document_masters m
                JOIN LATERAL (
                    SELECT r.* FROM document_revisions r
                    WHERE r.master_id = m.id AND r.deleted_at IS NULL
                    ORDER BY version_to_int(r.version) DESC LIMIT 1
                ) latest_r ON TRUE
                LEFT JOIN users co_user ON co_user.id = latest_r.check_out_user_id
                LEFT JOIN (
                    SELECT master_id, COUNT(*) AS cnt FROM document_revisions WHERE deleted_at IS NULL GROUP BY master_id
                ) v_cnt ON v_cnt.master_id = m.id
                LEFT JOIN (
                    SELECT revision_id, COUNT(*) AS cnt FROM document_iterations GROUP BY revision_id
                ) it_cnt ON it_cnt.revision_id = latest_r.id
                LEFT JOIN LATERAL (
                    SELECT da.file_name, da.id, da.file_size
                    FROM document_iterations di_att
                    JOIN document_attachments da ON da.iteration_id = di_att.id
                    WHERE di_att.revision_id = latest_r.id AND di_att.iteration = latest_r.latest_iteration
                    ORDER BY da.created_at LIMIT 1
                ) att ON TRUE
                {base_where} {where_search} {where_status} {where_accessible}
            )
            SELECT * FROM ranked
            ORDER BY {order_col} {order_dir} {nulls}
            LIMIT :limit OFFSET :offset
        """

    params = {
        'limit': page_size, 'offset': (page - 1) * page_size,
        **search_params, **status_params, **acc_params,
    }
    total = db.execute(text(sql_count), params).scalar()
    rows = db.execute(text(sql_items), params).mappings().all()

    items: List[Dict] = []
    for row in rows:
        fid = row['file_id']
        items.append({
            'id': str(row['revision_id']),
            'revision_id': str(row['revision_id']),
            'master_id': str(row['master_id']),
            'code': row['code'],
            'name': row['name'],
            'version': row['version'],
            'status': row['status'],
            'check_out_user_id': str(row['check_out_user_id']) if row['check_out_user_id'] else None,
            'check_out_user_name': row['check_out_user_name'],
            'check_out_date': row['check_out_date'].isoformat() if row['check_out_date'] else None,
            'latest_iteration': row['latest_iteration'],
            'iteration_count': row['iteration_count'] or 0,
            'file_name': row['file_name'],
            'file_id': str(fid) if fid else None,
            'file_size': row['file_size'],
            'remark': row['remark'],
            'created_at': row['created_at'].isoformat() if row['created_at'] else None,
            'updated_at': row['master_updated_at'].isoformat() if row['master_updated_at'] else None,
            'version_count': row['version_count'] or 0,
        })

    return items, total


# ====== 迭代列表和详情 ======

def list_iterations(db: Session, revision_id: UUID) -> list:
    """获取某版本下全部迭代（含各自附件清单）"""
    revision = get_document_revision(db, revision_id)
    if not revision:
        return []
    iterations = (
        db.query(models.DocumentIteration)
        .filter(models.DocumentIteration.revision_id == revision_id)
        .order_by(models.DocumentIteration.iteration.desc())
        .all()
    )
    result = []
    for it in iterations:
        atts = it.attachments.all()
        result.append(
            {
                "id": str(it.id),
                "iteration": it.iteration,
                "check_in_date": it.check_in_date.isoformat()
                if it.check_in_date
                else None,
                "check_in_note": it.check_in_note,
                "created_at": it.created_at.isoformat()
                if it.created_at
                else None,
                "creator_id": str(it.creator_id) if it.creator_id else None,
                "attachments": [
                    {
                        "id": str(a.id),
                        "file_name": a.file_name,
                        "file_size": a.file_size,
                        "file_path": a.file_path,
                        "created_at": a.created_at.isoformat()
                        if a.created_at
                        else None,
                    }
                    for a in atts
                ],
            }
        )
    return result


def get_iteration_detail(
    db: Session, iteration_id: UUID
) -> Optional[models.DocumentIteration]:
    return (
        db.query(models.DocumentIteration)
        .filter(models.DocumentIteration.id == iteration_id)
        .first()
    )


def delete_iteration(
    db: Session, revision_id: UUID, iteration_id: UUID
) -> Tuple[bool, Optional[str]]:
    """删除指定迭代（管理员操作，不能删除唯一迭代）"""
    revision = get_document_revision(db, revision_id)
    if not revision:
        return False, "版本不存在"
    if revision.latest_iteration <= 1:
        return False, "至少需保留一个迭代"

    iteration = (
        db.query(models.DocumentIteration)
        .filter(
            models.DocumentIteration.id == iteration_id,
            models.DocumentIteration.revision_id == revision_id,
        )
        .first()
    )
    if not iteration:
        return False, "迭代不存在"

    atts = iteration.attachments.all()
    for att in atts:
        if att.file_path:
            try:
                file_storage.delete_file(att.file_path)
            except Exception:
                pass
        # 同步清理预览缓存（glb/pdf）
        try:
            from .office_converter import delete_pdf_cache, is_office_file
            from .stp_converter import delete_glb_cache, is_stp_file
            if is_stp_file(att.file_name):
                delete_glb_cache(str(att.id), att.file_path)
            if is_office_file(att.file_name):
                delete_pdf_cache(str(att.id), att.file_path)
        except Exception:
            pass
        db.delete(att)

    db.query(models.CustomFieldValue).filter(
        models.CustomFieldValue.iteration_id == iteration.id
    ).delete(synchronize_session=False)

    db.delete(iteration)

    if iteration.iteration == revision.latest_iteration:
        remaining = (
            db.query(models.DocumentIteration)
            .filter(models.DocumentIteration.revision_id == revision_id)
            .order_by(models.DocumentIteration.iteration.desc())
            .first()
        )
        revision.latest_iteration = remaining.iteration if remaining else 0

    db.commit()
    return True, None


# ====== 向后兼容别名 ======

def get_document(
    db: Session, doc_id: UUID
) -> Optional[models.DocumentRevision]:
    """向后兼容：按 revision_id 获取版本"""
    return get_document_revision(db, doc_id)


def get_current_iteration(
    db: Session, revision
) -> Optional[models.DocumentIteration]:
    """向后兼容：传入 DocumentRevision 实例获取最新迭代"""
    if isinstance(revision, models.DocumentRevision):
        if revision.latest_iteration == 0:
            return None
        return (
            db.query(models.DocumentIteration)
            .filter(
                models.DocumentIteration.revision_id == revision.id,
                models.DocumentIteration.iteration == revision.latest_iteration,
            )
            .first()
        )
    return None


def where_used_parts_by_document(db, doc_revision_id) -> list:
    """反查：迭代 document_links 引用了该图文档版本的零部件（按零件 master 去重）。"""
    from app.models_parts import PartIteration, PartRevision, PartMaster
    rev_str = str(doc_revision_id)
    seen, out = set(), []
    for it in db.query(PartIteration).all():
        if not any(l.get("document_id") == rev_str for l in (it.document_links or [])):
            continue
        pr = db.query(PartRevision).filter(
            PartRevision.id == it.revision_id, PartRevision.deleted_at.is_(None)).first()
        if not pr:
            continue
        pm = db.query(PartMaster).filter(
            PartMaster.id == pr.master_id, PartMaster.deleted_at.is_(None)).first()
        if not pm or str(pm.id) in seen:
            continue
        seen.add(str(pm.id))
        out.append({"master_id": str(pm.id), "revision_id": str(pr.id),
                    "code": pm.code, "name": pm.name, "type": pm.type,
                    "version": pr.version, "status": pr.status})
    return out
