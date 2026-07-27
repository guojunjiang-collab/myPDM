import { useEffect, useRef, useState } from 'react';
import { APP_VERSION } from '../constants';

/* ================================================================
   帮助文档页
   —— 面向新用户的系统使用指南
   —— 左侧目录 + 右侧内容，风格沿用现有页面（primary-* 配色、卡片式）
   ================================================================ */

type Section = {
  id: string;
  icon: string;
  title: string;
  body: React.ReactNode;
};

/** 小标题 */
function H({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold text-gray-800 mt-5 mb-2">{children}</h3>;
}

/** 段落 */
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-600 leading-7 mb-2">{children}</p>;
}

/** 有序步骤 */
function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="list-decimal pl-5 space-y-1 text-sm text-gray-600 leading-7 mb-2">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ol>
  );
}

/** 无序列表 */
function UL({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc pl-5 space-y-1 text-sm text-gray-600 leading-7 mb-2">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

/** 提示框 */
function Tip({ children, type = 'info' }: { children: React.ReactNode; type?: 'info' | 'warn' }) {
  const cls =
    type === 'warn'
      ? 'bg-amber-50 border-amber-200 text-amber-800'
      : 'bg-primary-50 border-primary-200 text-primary-700';
  return <div className={`text-sm border rounded-lg px-3 py-2 my-2 leading-7 ${cls}`}>{children}</div>;
}

/** 关键词/按钮名 */
function K({ children }: { children: React.ReactNode }) {
  return <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-[13px] mx-0.5">{children}</span>;
}

/** 简单表格 */
function MiniTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto my-2">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 text-gray-600">
            {head.map((h, i) => (
              <th key={i} className="border border-gray-200 px-3 py-2 text-left font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="text-gray-600">
              {r.map((c, ci) => (
                <td key={ci} className="border border-gray-200 px-3 py-2 align-top leading-6">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 版本级 / 迭代级 标签 */
function LevelTag({ level }: { level: '版本级' | '迭代级' }) {
  const cls = level === '版本级' ? 'bg-primary-50 text-primary-700' : 'bg-amber-50 text-amber-700';
  return <span className={`px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${cls}`}>{level}</span>;
}

const sections: Section[] = [
  {
    id: 'intro',
    icon: '🏗️',
    title: '系统简介',
    body: (
      <>
        <P>
          本系统是一套<strong>网页版 PDM（产品数据管理）系统</strong>，用于统一管理零部件、图文档、BOM
          结构、构型、工程变更、库存与项目全生命周期数据，支持多用户、多角色协同。
        </P>
        <P>打开浏览器访问系统地址即可使用，无需安装任何客户端。推荐使用 Chrome / Edge 等现代浏览器。</P>
        <H>整体界面布局</H>
        <UL
          items={[
            <>
              <strong>左侧导航栏</strong>：切换各功能模块，会根据你的角色显示可访问的菜单。
            </>,
            <>
              <strong>顶部栏</strong>：显示当前模块名称/子页签、数据同步状态、通知铃铛、当前用户与退出登录。
            </>,
            <>
              <strong>主内容区</strong>：当前模块的操作区域。
            </>,
            <>
              <strong>右下角悬浮 AI 助手</strong>：随时点击提问，辅助你了解系统与数据。
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'login',
    icon: '🔑',
    title: '登录与账号',
    body: (
      <>
        <Steps
          items={[
            <>在登录页输入用户名与密码，点击登录。</>,
            <>首次登录后建议前往 <K>系统设置</K> 修改初始密码。</>,
            <>如需退出，点击右上角 <K>退出登录</K>。</>,
          ]}
        />
        <Tip type="warn">忘记密码时，请联系管理员在「用户管理」中为你重置。</Tip>
      </>
    ),
  },
  {
    id: 'roles',
    icon: '👤',
    title: '角色与权限',
    body: (
      <>
        <P>系统内置四种角色，登录后顶部会显示你的角色标签，不同角色可见的菜单和可执行的操作不同：</P>
        <UL
          items={[
            <>
              <K>管理员</K>：拥有全部权限，可管理用户、系统设置、自定义字段、查看操作日志。
            </>,
            <>
              <K>工程师</K>：可创建/编辑零部件、图文档、BOM、构型、发起并处理工程变更、管理项目。
            </>,
            <>
              <K>生产人员</K>：以查询为主，可查看零部件、BOM、图文档、库存等数据。
            </>,
            <>
              <K>访客</K>：只读权限，用于浏览查看。
            </>,
          ]}
        />
        <Tip>若某个按钮为灰色或不可见，通常表示你的角色没有该操作权限，请联系管理员。</Tip>
      </>
    ),
  },
  {
    id: 'concepts',
    icon: '📚',
    title: '通用概念（务必先了解）',
    body: (
      <>
        <P>
          零部件、图文档、构型项采用「主对象 → 版本 → 迭代」三层模型，详见后面的「数据模型」章节。
        </P>
        <H>状态流转</H>
        <P>对象通常经历以下状态，颜色标签一目了然：</P>
        <UL
          items={[
            <>
              <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-xs">草稿</span>{' '}
              可自由编辑，尚未定型。
            </>,
            <>
              <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 text-xs">冻结</span>{' '}
              暂停修改、待评审。
            </>,
            <>
              <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-xs">发布</span>{' '}
              正式生效，一般不可直接改动，需通过变更流程。
            </>,
            <>
              <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-xs">作废</span>{' '}
              停止使用。
            </>,
          ]}
        />
        <H>签入 / 签出</H>
        <P>
          编辑图文档等对象时采用「签出（锁定编辑）→ 修改 → 签入（解锁并保存版本）」机制，避免多人同时改动冲突。
        </P>
        <H>数据同步（检出）</H>
        <P>
          系统默认自动同步，顶部的绿色小圆点表示已同步。若怀疑数据不是最新，可点击顶部的 <K>↻</K>{' '}
          手动强制同步；显示「同步失败」时点击重试即可。
        </P>
      </>
    ),
  },
  {
    id: 'data-model',
    icon: '🧱',
    title: '数据模型',
    body: (
      <>
        <P>
          系统的核心数据（零部件、图文档、构型项）都采用统一的「主对象 → 版本 → 迭代」三层模型。理解它是用好系统的基础。
        </P>
        <H>三类实体</H>
        <P>下面三类实体结构一致，均支持版本控制，并在「版本」层进行签入签出：</P>
        <UL
          items={[
            <>
              <K>零部件</K>：零件与部件，含 BOM 结构。
            </>,
            <>
              <K>图文档</K>：图纸、文档及其附件。
            </>,
            <>
              <K>构型项</K>：产品构型/配置项，含子构型项、关联零部件。
            </>,
          ]}
        />
        <H>三层结构：主对象 / 版本 / 迭代</H>
        <UL
          items={[
            <>
              <K>主对象（Master）</K>：对象的稳定身份，保存编号、名称等基本标识，贯穿其整个生命周期。
            </>,
            <>
              <K>版本（Revision）</K>：字母号 <K>A</K> → <K>B</K> → <K>C</K> … → <K>ZZ</K>（24 进制，跳过易混淆的 I、O），
              代表一次<strong>正式改版</strong>。每个版本拥有独立的状态（草稿/冻结/发布/作废）和签出锁，可在详情弹窗的「版本历史」页签查看。
            </>,
            <>
              <K>迭代（Iteration）</K>：版本内部的数字序号 <K>1</K>、<K>2</K>、<K>3</K>…，每次「签出 → 修改 → 签入」
              产生一个新迭代，记录同一版本内的<strong>小步修改过程</strong>，可在「迭代历史」页签查看。
            </>,
          ]}
        />
        <P>
          一句话：<strong>换版（升字母）</strong>是正式改版；<strong>迭代（加数字）</strong>是同一版本内的日常修改留痕。
        </P>
        <H>数据绑定层级</H>
        <P>
          不同数据分别绑定在「版本」或「迭代」上，这决定了你在「迭代历史」中回看旧迭代时，看到的内容是否会跟着变化：
        </P>
        <MiniTable
          head={['数据', '绑定层级', '说明']}
          rows={[
            [<>基本属性</>, <LevelTag level="版本级" />, <>随版本保存。</>],
            [
              <>
                <K>自定义字段</K>
              </>,
              <LevelTag level="版本级" />,
              <>字段值绑定到版本（entity_id 指向 revision），同一版本各迭代共享。</>,
            ],
            [<>关联图文档</>, <LevelTag level="版本级" />, <>始终显示当前最新迭代的内容，不随迭代历史变化。</>],
            [<>构型项的关联零部件</>, <LevelTag level="版本级" />, <>始终显示当前最新迭代的内容，不随迭代历史变化。</>],
            [
              <>
                <K>BOM 子件</K>
              </>,
              <LevelTag level="迭代级" />,
              <>绑定到迭代；查看历史迭代会还原当时的 BOM。</>,
            ],
            [
              <>
                <K>附件</K>
              </>,
              <LevelTag level="迭代级" />,
              <>绑定到迭代；查看历史迭代会还原当时的附件。</>,
            ],
          ]}
        />
        <Tip>
          其中<strong>自定义字段绑定在版本上</strong>（同一版本各迭代共享同一份值），详见下一节「自定义字段」。
        </Tip>
      </>
    ),
  },
  {
    id: 'custom-fields',
    icon: '🏷️',
    title: '自定义字段',
    body: (
      <>
        <P>
          除系统内置属性外，管理员可在 <K>系统设置 → 自定义字段</K> 为不同类型的数据扩展额外字段，满足企业自身的数据管理需求。
        </P>
        <H>字段类型</H>
        <UL
          items={[
            <>
              <K>单行文本</K>、<K>数字</K>、<K>下拉选择</K>、<K>多选</K>。
            </>,
            <>定义字段时可设置：字段名、是否必填、下拉/多选的可选项、排序。</>,
          ]}
        />
        <H>可应用的数据类型</H>
        <P>
          自定义字段可分别应用到 <K>零部件</K>、<K>图文档</K>、<K>构型项</K>；同一个字段可同时适用于多种类型。
        </P>
        <H>字段值绑定在「版本」上（重要）</H>
        <P>
          自定义字段的<strong>取值绑定在对象的「版本（Revision）」上，而不是「迭代（Iteration）」</strong>，具体表现为：
        </P>
        <UL
          items={[
            <>同一版本下，无论经历多少次迭代（签入签出），这套自定义字段值都是同一份、共享的；</>,
            <>只有当对象升版（如 A → B）后，新版本才拥有独立的一份字段值，可与旧版本不同；</>,
            <>因此填写/修改自定义字段时，改动作用于当前版本整体，而不是某一次迭代。</>,
          ]}
        />
        <Tip type="warn">
          若某个自定义字段没有显示，通常是管理员尚未为该数据类型定义该字段，或字段的适用范围未包含此类型，请联系管理员确认。
        </Tip>
      </>
    ),
  },
  {
    id: 'dashboard',
    icon: '📊',
    title: '仪表盘',
    body: (
      <>
        <P>登录后的首页，快速概览与你相关的信息：待办事项、我负责的任务、以及关键数据统计等。</P>
        <P>点击卡片中的条目通常可直接跳转到对应模块查看详情。</P>
      </>
    ),
  },
  {
    id: 'board',
    icon: '📋',
    title: '用户看板',
    body: (
      <>
        <P>你的个人工作区，可把常用的零部件、图文档、构型项收藏整理到自定义文件夹中，方便随时打开。</P>
        <UL
          items={[
            <>新建文件夹，将关注的对象拖入或添加进去分类管理。</>,
            <>顶部按类型（零部件 / 图文档 / 构型）筛选。</>,
            <>可将文件夹分享给其他同事协同查看。</>,
            <>点击条目直接打开对应的详情弹窗。</>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'configuration',
    icon: '📐',
    title: '构型管理',
    body: (
      <>
        <P>管理产品构型（不同配置组合）的模块，包含两个子页签：</P>
        <UL
          items={[
            <>
              <K>构型项管理</K>：维护构型项及其版本，定义有效性/适用范围。
            </>,
            <>
              <K>构型配置</K>：基于构型项组合出具体的产品配置方案。在构型配置列表中点击 <K>⇄ 配置对比</K> 按钮，可对比两个配置的正式清单差异，以树形表格展示构型项和零部件的新增、删除、修改。
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'parts',
    icon: '📦',
    title: '零部件管理',
    body: (
      <>
        <P>管理零件与部件主数据的核心模块。</P>
        <H>常用操作</H>
        <Steps
          items={[
            <>
              点击 <K>新增</K> 创建零部件，填写编号、名称、规格等信息。
            </>,
            <>顶部搜索框支持按编号 / 名称 / 规格检索，并可按状态筛选。</>,
            <>勾选「显示所有版本」可查看历史版本；勾选「仅顶层」可过滤子件。</>,
            <>点击某行打开详情弹窗，查看/编辑属性、BOM 结构、关联图文档、自定义字段等。</>,
          ]}
        />
        <H>反查（Where-Used）</H>
        <P>
          点击某行打开零部件详情弹窗，切换到 <K>反查</K> 页签，即可查询该零部件被哪些上层部件、构型、任务、变更引用，帮助你评估改动影响面。
        </P>
        <H>BOM 对比</H>
        <P>
          在零部件列表工具栏点击 <K>⇄ BOM对比</K> 按钮，选择左右两侧的部件后点击「开始对比」，以树形表格展示两个部件 BOM 树的新增、删除、修改差异，支持展开/折叠层级、仅显示差异。
        </P>
        <H>CAD 工作区</H>
        <P>可上传并预览关联的 3D 模型/图纸（如 STEP 文件），在浏览器中直接查看模型。</P>
      </>
    ),
  },
  {
    id: 'documents',
    icon: '📄',
    title: '图文档管理',
    body: (
      <>
        <P>管理图纸、文档及其附件的模块，支持版本与签入签出。</P>
        <Steps
          items={[
            <>
              点击 <K>新增</K> 创建图文档，填写编号、名称，并可设置可访问的用户组（权限）。
            </>,
            <>进入详情后，通过「签出」锁定编辑，上传/替换附件后「签入」保存为新版本。</>,
            <>在详情的「版本」页签可查看历史版本记录。</>,
            <>支持在线预览 PDF、Office 文档、图纸及压缩包内文件。</>,
          ]}
        />
        <H>反查</H>
        <P>图文档详情内提供反查页签，可查看该文档被哪些构型项、零部件、任务、ECO、ECR 引用。</P>
      </>
    ),
  },
  {
    id: 'ec',
    icon: '🔄',
    title: '变更管理',
    body: (
      <>
        <P>管理工程变更的模块，规范化「提出问题 → 下达变更 → 执行」的流程：</P>
        <UL
          items={[
            <>
              <K>工程变更请求（ECR）</K>：由发现问题的人发起，描述变更需求，走评审流程。
            </>,
            <>
              <K>工程变更指令（ECO）</K>：ECR 通过后下达的正式执行指令，跟踪执行落地。
            </>,
            <>
              <K>工程变更通知（ECN）</K>：功能开发中，敬请期待。
            </>,
          ]}
        />
        <Tip>发起 ECR 时可关联相关图文档与零部件，评审人会收到通知提醒处理。</Tip>
      </>
    ),
  },
  {
    id: 'inventory',
    icon: '🏬',
    title: '库存管理',
    body: (
      <>
        <P>管理多仓库库存与出入库单据的模块，含四个子页签：</P>
        <UL
          items={[
            <>
              <K>库存查询</K>：按仓库/物料查询实时库存数量。
            </>,
            <>
              <K>单据</K>：创建入库、出库、调拨、盘点等单据，经审批后过账更新库存。
            </>,
            <>
              <K>物料主数据</K>：维护参与库存管理的物料信息。
            </>,
            <>
              <K>仓库</K>：维护仓库及库位。
            </>,
          ]}
        />
        <Tip type="warn">单据需按流程提交并审批通过后才会更新库存，请勿跳过审批环节。</Tip>
      </>
    ),
  },
  {
    id: 'projects',
    icon: '🗂️',
    title: '项目管理',
    body: (
      <>
        <P>管理研发/生产项目与任务分解（WBS）的模块，含两个子页签：</P>
        <UL
          items={[
            <>
              <K>项目汇总</K>：查看所有项目的状态（待启动 / 进行中 / 已完成 / 已暂停 / 已归档）与进度概览。
            </>,
            <>
              <K>项目详情</K>：进入单个项目，进行 WBS 任务分解、指派负责人、设置计划起止时间、维护任务依赖，并在甘特图上查看排期。
            </>,
          ]}
        />
        <P>任务可关联图文档、零部件等对象，并支持评论协作。逾期任务会高亮提醒。</P>
      </>
    ),
  },
  {
    id: 'assistant',
    icon: '🤖',
    title: 'AI 助手',
    body: (
      <>
        <P>界面右下角的悬浮助手，点击展开对话窗口，可用自然语言向它提问，例如询问某个功能怎么用、帮你查找/理解数据等。</P>
        <P>不确定操作时，先问一问 AI 助手往往是最快的方式。</P>
      </>
    ),
  },
  {
    id: 'admin',
    icon: '⚙️',
    title: '用户管理与系统设置',
    body: (
      <>
        <P>
          面向管理员/进阶用户的配置模块（部分功能仅管理员可见）：
        </P>
        <UL
          items={[
            <>
              <K>用户管理</K>：新增/编辑/停用用户，分配角色。
            </>,
            <>
              <K>系统设置</K>：修改个人密码；管理自定义字段（为零部件、图文档、构型项扩展字段）；数据导入导出；查看操作日志。
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: 'faq',
    icon: '❓',
    title: '常见问题',
    body: (
      <>
        <H>页面数据看起来不是最新的？</H>
        <P>点击顶部的 <K>↻</K> 手动同步；若仍异常，可在同步失败时点击重试，或刷新浏览器。</P>
        <H>某个按钮点不了 / 看不到某个菜单？</H>
        <P>多为角色权限限制，请确认你的角色，或联系管理员开通权限。</P>
        <H>为什么发布状态的对象改不了？</H>
        <P>发布后的对象需要通过「变更管理（ECR/ECO）」流程进行修改，以保证数据可追溯。</P>
        <H>忘记密码怎么办？</H>
        <P>联系管理员在「用户管理」中重置。</P>
        <H>附件传不上去？</H>
        <P>确认文件大小不超过 100MB，且为系统支持的格式（图片、PDF、Office、DXF 等）。</P>
      </>
    ),
  },
];

export default function Help() {
  const [active, setActive] = useState<string>(sections[0].id);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 滚动高亮当前章节（以右侧内容区为滚动容器）
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { root, rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    );
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex gap-6 h-full overflow-hidden">
      {/* 左侧目录（固定，不随内容滚动） */}
      <aside className="w-52 shrink-0 hidden md:flex flex-col overflow-y-auto">
        <div className="text-xs font-semibold text-gray-400 px-3 mb-2">目录</div>
        <nav className="space-y-0.5">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className={`w-full text-left flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                active === s.id ? 'bg-primary-50 text-primary-600 font-medium' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <span>{s.icon}</span>
              <span className="truncate">{s.title}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* 右侧内容（唯一滚动区域） */}
      <div ref={scrollRef} className="flex-1 min-w-0 overflow-y-auto pr-1">
        {/* 头部横幅 */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h1 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
            <span>🏗️</span> PDM 系统使用指南
          </h1>
          <p className="text-sm text-gray-500 mt-2">
            面向新用户的功能说明与操作指引。左侧目录可快速跳转，遇到问题也可点击右下角 AI 助手提问。
          </p>
          <div className="text-xs text-gray-400 mt-3">当前版本 {APP_VERSION}</div>
        </div>

        {/* 各章节 */}
        <div className="space-y-6 pb-16">
          {sections.map((s) => (
            <section
              key={s.id}
              id={s.id}
              className="bg-white rounded-lg border border-gray-200 p-6 scroll-mt-4"
            >
              <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2 mb-3">
                <span>{s.icon}</span>
                {s.title}
              </h2>
              {s.body}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
