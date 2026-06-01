import { NavLink, useNavigate } from 'react-router-dom'
import { getCurrentUser, signOut, deptLabel } from '../lib/auth'
import { useAppData } from '../store/AppDataContext'
import {
  Grid,
  List,
  Calendar,
  Activity,
  CheckSquare,
  Truck,
  Package,
  HardDrive,
  Users,
  Factory,
  ArrowDown,
  ArrowUp,
  Shield,
  LogOut,
  SlidersHorizontal,
  Loader2,
  GitMerge,
} from 'lucide-react'

const iconMap = {
  grid: Grid,
  list: List,
  cal: Calendar,
  wave: Activity,
  'check-sq': CheckSquare,
  truck: Truck,
  pkg: Package,
  machine: HardDrive,
  users: Users,
  factory: Factory,
  down: ArrowDown,
  up: ArrowUp,
  shield: Shield,
  logout: LogOut,
  options: SlidersHorizontal,
  merge: GitMerge,
}

function I({ n, s = 16, w = 1.8 }) {
  const Icon = iconMap[n]
  return Icon ? <Icon size={s} strokeWidth={w} className="ic" /> : null
}

function Logo({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <defs>
        <linearGradient id="elmoSidebarLogoGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#f6f3ec" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="18" fill="url(#elmoSidebarLogoGrad)" stroke="rgba(26,29,36,0.10)" />
      <circle cx="44" cy="22" r="5" fill="var(--amber)" />
      <path d="M6 46 L20 28 L28 38 L40 22 L52 46 Z" fill="var(--navy)" />
    </svg>
  )
}

const sidebarStyles = `
.app { display: grid; grid-template-columns: 256px 1fr; min-height: 100vh; }

.side {
  background: var(--surface);
  border-right: 1px solid var(--hairline);
  padding: 18px 14px 18px;
  display: flex; flex-direction: column; gap: 14px;
  position: sticky; top: 0; height: 100vh;
  overflow-y: auto;
}
.side .brand {
  display: flex; align-items: center; gap: 10px; padding: 4px 6px 8px;
  border-bottom: 1px solid var(--hairline);
}
.side .brand .mark {
  width: 38px; height: 38px; border-radius: 12px;
  border: 1px solid var(--hairline-2);
  display: flex; align-items: center; justify-content: center;
  background: var(--surface-2);
  box-shadow: 0 1px 2px rgba(26,29,36,0.04);
  flex-shrink: 0;
}
.side .brand .name { line-height: 1.1; }
.side .brand .name b {
  font-size: 15px; font-weight: 600; letter-spacing: -0.02em;
  display: block; color: var(--ink);
}
.side .brand .name b em { font-style: normal; color: var(--amber); }
.side .brand .name span {
  font-size: 11px; color: var(--ink-3); font-weight: 500;
  letter-spacing: 0.02em;
}

.side .ctx-card {
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  border-radius: 14px;
  padding: 10px 12px;
  display: flex; flex-direction: column; gap: 6px;
}
.side .ctx-card .row {
  display: flex; align-items: center; gap: 8px;
  padding: 0;
  font-size: 12px; color: var(--ink-2); font-weight: 500;
  min-width: 0;
  grid-template-columns: none;
}
.side .ctx-card .row .ic { width: 14px; height: 14px; color: var(--ink-3); flex-shrink: 0; }
.side .ctx-card .row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.side .ctx-card .row b { color: var(--ink); font-weight: 600; }
.side .ctx-card .role-pill {
  align-self: flex-start;
  background: var(--navy); color: white;
  font-size: 11px; font-weight: 600;
  padding: 3px 9px;
  border-radius: 999px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.side .nav-group { display: flex; flex-direction: column; gap: 2px; }
.side .nav-title {
  font-size: 10px; font-weight: 600; letter-spacing: 0.1em;
  color: var(--ink-3); text-transform: uppercase;
  padding: 8px 10px 6px;
}
.side .nav-item {
  display: flex; align-items: center; gap: 11px;
  padding: 9px 11px;
  border-radius: 10px;
  font-size: 14px; font-weight: 500;
  color: var(--ink-2);
  cursor: pointer;
  text-decoration: none;
  transition: background 160ms ease, color 160ms ease;
  border: 1px solid transparent;
}
.side .nav-item .ic { width: 18px; height: 18px; flex-shrink: 0; color: var(--ink-3); }
.side .nav-item:hover { background: var(--surface-2); color: var(--ink); }
.side .nav-item[aria-current="page"] {
  background: var(--navy-soft);
  color: var(--navy);
  font-weight: 600;
}
.side .nav-item[aria-current="page"] .ic { color: var(--navy); }
[data-theme="dark"] .side .nav-item[aria-current="page"] {
  background: var(--navy-soft);
  color: var(--amber-2);
}
[data-theme="dark"] .side .nav-item[aria-current="page"] .ic { color: var(--amber-2); }
.side .nav-item .badge {
  margin-left: auto;
  background: var(--amber-soft); color: var(--amber);
  font-size: 10px; font-weight: 700;
  padding: 2px 7px; border-radius: 999px;
  line-height: 1.4;
}
.side .nav-item .badge.critical {
  background: var(--red-soft, rgba(210,83,58,0.10));
  color: var(--red, #d2533a);
}

.side .side-foot {
  margin-top: auto;
  display: flex; flex-direction: column; gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--hairline);
}
.side .util-row { display: flex; gap: 6px; }
.side .util-btn {
  flex: 1;
  appearance: none; border: 1px solid var(--hairline-2);
  background: var(--surface-2);
  color: var(--ink-2);
  border-radius: 10px;
  padding: 8px 10px;
  font: inherit; font-size: 12px; font-weight: 500;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  cursor: pointer;
  text-decoration: none;
}
.side .util-btn:hover { background: var(--surface); color: var(--ink); }
.side .util-btn[aria-current="page"] { background: var(--navy-soft); color: var(--navy); border-color: rgba(31,42,68,0.2); }
.side .util-btn .ic { width: 13px; height: 13px; color: var(--ink-3); }
.side .util-btn[aria-current="page"] .ic { color: var(--navy); }

.side .signout {
  width: 100%; appearance: none; border: 1px solid var(--hairline-2);
  background: var(--surface-2); color: var(--ink-2);
  border-radius: 12px; padding: 10px;
  font: inherit; font-size: 13px; font-weight: 500;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  cursor: pointer;
}
.side .signout:hover {
  background: var(--red-soft); color: var(--red);
  border-color: var(--red);
}
.side .signout .ic { width: 14px; height: 14px; }

.side .meta-foot {
  font-size: 11px; color: var(--ink-3);
  display: flex; flex-direction: column; gap: 2px;
  padding: 6px 4px 0;
}
.side .meta-foot .sync { display: flex; align-items: center; gap: 6px; }
.side .meta-foot .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); }
.side .meta-foot .sync.syncing { color: var(--amber); }
.side .meta-foot .sync.syncing .dot { background: var(--amber); }
.side .meta-foot .sync .spin { animation: side-spin 800ms linear infinite; color: var(--amber); }
@keyframes side-spin { to { transform: rotate(360deg); } }

.side .ic { display: inline-block; vertical-align: middle; }

@media (max-width: 1100px) {
  .app { grid-template-columns: 1fr; }
  .side { position: relative; height: auto; }
}
`

const sections = [
  {
    group: 'Production', items: [
      { id: 'dash', to: '/dashboard', label: 'Dashboard', icon: 'grid' },
      { id: 'pri', to: '/priority', label: 'Priority', icon: 'list', badge: 2 },
      { id: 'reconcile', to: '/reconcile', label: 'Reconcile', icon: 'merge', roles: ['Boss', 'Manager'], badgeKey: 'needsReview' },
      { id: 'week', to: '/week', label: 'Week Plan', icon: 'cal' },
      { id: 'sched', to: '/schedule', label: 'Schedule', icon: 'wave' },
    ],
  },
  {
    group: 'Tracking', items: [
      { id: 'track', to: '/tracking', label: 'Tracking', icon: 'check-sq' },
      { id: 'disp', to: '/dispatch', label: 'Dispatch', icon: 'truck' },
    ],
  },
  {
    group: 'Config', items: [
      { id: 'prod', to: '/products', label: 'Products', icon: 'pkg', roles: ['Boss', 'Manager'] },
      { id: 'mach', to: '/machines', label: 'Machines', icon: 'machine', roles: ['Boss', 'Manager'] },
      { id: 'cust', to: '/customers', label: 'Customers', icon: 'users', roles: ['Boss', 'Manager'] },
      { id: 'opts', to: '/options', label: 'Options', icon: 'options', roles: ['Boss'] },
    ],
  },
]

const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatSyncTime(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatToday(d) {
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()} · ${DAYS_FULL[d.getDay()]}`
}

export default function Sidebar() {
  const navigate = useNavigate()
  const user = getCurrentUser()
  const { isLoading, lastSynced, orders } = useAppData()
  // Live counters surfaced as sidebar badges. Lookup by `badgeKey` on each
  // nav item — keeps the sections config declarative. Reconcile badge counts
  // only orders that NEED MANUAL ACTION (product code couldn't be matched
  // from CSV import). Unscheduled-but-valid orders are noise here.
  const liveBadges = {
    needsReview: (orders || []).filter((o) => o.needs_review).length,
  }
  const handleLogout = () => {
    signOut()
    navigate('/login')
  }
  return (
    <>
      <style>{sidebarStyles}</style>
      <aside className="side">
        <div className="brand">
          <div className="mark"><Logo /></div>
          <div className="name">
            <b><em>elmo's</em> Production</b>
            <span>Steelworks · Plant 2</span>
          </div>
        </div>

        <div className="ctx-card">
          <div className="role-pill">{user?.role || 'Guest'}</div>
          <div className="row"><I n="factory" s={14} /> <span>{deptLabel(user?.activeDepartment)}</span></div>
          <div className="row"><I n="users" s={14} /> <span>signed in as <b>{user?.name || '—'}</b></span></div>
        </div>

        {sections.map((section) => {
          const visible = section.items.filter((item) => !item.roles || item.roles.includes(user?.role))
          if (visible.length === 0) return null
          return (
            <div key={section.group} className="nav-group">
              <div className="nav-title">{section.group}</div>
              {visible.map((item) => {
                const liveBadge = item.badgeKey ? liveBadges[item.badgeKey] : null
                const badge = liveBadge != null && liveBadge > 0 ? liveBadge : item.badge
                // Reconcile pending = needs the user's attention; mark it red.
                const isCritical = item.badgeKey === 'needsReview' && liveBadge > 0
                return (
                  <NavLink
                    key={item.id}
                    to={item.to}
                    end
                    className="nav-item"
                  >
                    <I n={item.icon} s={18} />
                    <span>{item.label}</span>
                    {badge && <span className={`badge ${isCritical ? 'critical' : ''}`}>{badge}</span>}
                  </NavLink>
                )
              })}
            </div>
          )
        })}

        <div className="side-foot">
          {user?.role !== 'Worker' && (
            <div className="util-row">
              <button className="util-btn"><I n="down" s={13} /> Export</button>
              <button className="util-btn"><I n="shield" s={13} /> Backups</button>
              <NavLink to="/import" end className="util-btn"><I n="up" s={13} /> Import</NavLink>
            </div>
          )}
          <button className="signout" onClick={handleLogout}><I n="logout" s={14} /> Logout</button>
          <div className="meta-foot">
            <div className={`sync ${isLoading ? 'syncing' : ''}`}>
              {isLoading
                ? (<><Loader2 size={11} strokeWidth={2.4} className="spin" /> Syncing…</>)
                : (<><span className="dot" /> Synced {lastSynced ? formatSyncTime(lastSynced) : '—'}</>)}
            </div>
            <div>{formatToday(new Date())}</div>
          </div>
        </div>
      </aside>
    </>
  )
}
