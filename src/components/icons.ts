/**
 * Alias de íconos: nombre del handoff de diseño → componente de lucide-react.
 *
 * El handoff especifica Material Symbols Rounded. No se adopta: traerla desde
 * Google Fonts obligaría a abrir `font-src` y `style-src` en la CSP de
 * `next.config.ts`, que el hardening B3 cerró a propósito. Auto-hospedarla
 * exige subsetear a mano y rehacer el subset con cada ícono nuevo. A wght 300
 * el trazo de ambas familias es muy parecido.
 *
 * Son re-exports nombrados y no un `Record<string, LucideIcon>` porque un mapa
 * indexado por string obliga al bundler a incluir todos los íconos en cada
 * página que importe el módulo. Los re-exports preservan el tree-shaking; el
 * alias conserva la trazabilidad contra el handoff.
 */
export {
  BarChart3 as BarChartIcon,
  Bot as SmartToy,
  BrainCircuit as Psychology,
  Car as DirectionsCar,
  Check as Done,
  CheckCheck as DoneAll,
  ChevronDown as KeyboardArrowDown,
  ChevronUp as KeyboardArrowUp,
  CircleAlert as ErrorIcon,
  CircleCheckBig as TaskAlt,
  CircleHelp as HelpIcon,
  Clock as Schedule,
  ContactRound as ContactEmergency,
  DatabaseZap as DatabaseSearch,
  Ellipsis as MoreHoriz,
  Gauge as Speed,
  Hand as PanTool,
  Inbox as InboxIcon,
  LayoutDashboard as Dashboard,
  LockKeyhole as LockClock,
  LogOut as Logout,
  Minus as Remove,
  PiggyBank as Savings,
  Package as Inventory2,
  Paperclip as AttachFile,
  Pause as PauseIcon,
  Pencil as Edit,
  Plus as Add,
  ReceiptText as ReceiptLong,
  Search as SearchIcon,
  Send as SendIcon,
  Settings as SettingsIcon,
  Settings2 as SettingsSuggest,
  ShieldCheck as VerifiedUser,
  SlidersHorizontal as Tune,
  Sparkles as AutoAwesome,
  Split as AltRoute,
  Tag as Sell,
  TriangleAlert as Warning,
  Users as Group,
  Workflow as AccountTree,
  Wrench as Handyman,
  X as Close,
  Zap as Bolt,
} from "lucide-react";
