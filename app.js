const fileInputs = {
  taxReturns: document.getElementById("reviewPackage"),
  workpapers: document.getElementById("workpapers"),
  documents: document.getElementById("documents"),
};

const labels = {
  taxReturns: "Tax Return",
  workpapers: "Workpaper",
  documents: "Related Document",
};

const filesByType = { taxReturns: [], workpapers: [], documents: [] };
const preparerFiles = { packageFiles: [] };
const noticeFiles = { noticeFile: null, priorReturn: null };
const organizerFiles = { priorYearReturn: null };
const deliverableState = { files: [], draft: null, gmailStatus: { authorized: false, email: null }, clientFolder: null, sendHistory: [] };
const estimatedTaxesState = {
  mode: "estimate",
  entityType: "1040",
  quarter: "Q1",
  lastResult: null,
  files: [],
  templateFile: null,
  plFile: null,
  plPeriod: null,
  balanceSheetFile: null,
  taxReturnFiles: [],
  additionalFiles: [],
  reviewedWorkpaper: null,
};
const presentationState = { files: [], lastResult: null };
const calculationState = { files: [], lastResult: null };
const taxReturnRoles = new Map();
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const API_BASE_URL = "";

const els = {
  form: document.getElementById("reviewForm"),
  clearFiles: document.getElementById("clearFiles"),
  results: document.getElementById("results"),
  progressList: document.getElementById("progressList"),
  validationMessages: document.getElementById("validationMessages"),
  reviewStatus: document.getElementById("reviewStatus"),
  runReview: document.getElementById("runReview"),
  runHint: document.getElementById("runHint"),
  userStatus: document.getElementById("userStatus"),
  dashboardButton: document.getElementById("dashboardButton"),
  dashboardOverlay: document.getElementById("dashboardOverlay"),
  closeDashboardButton: document.getElementById("closeDashboardButton"),
  newReviewButton: document.getElementById("newReviewButton"),
  dashboardSearch: document.getElementById("dashboardSearch"),
  dashboardRows: document.getElementById("dashboardRows"),
  statActiveSessions: document.getElementById("statActiveSessions"),
  statHighIssues: document.getElementById("statHighIssues"),
  statReadyToFile: document.getElementById("statReadyToFile"),
  statOverdue: document.getElementById("statOverdue"),
  exportDataButton: document.getElementById("exportDataButton"),
  clearDataButton: document.getElementById("clearDataButton"),
  settingsExportDataButton: document.getElementById("settingsExportDataButton"),
  settingsClearDataButton: document.getElementById("settingsClearDataButton"),
  saveIndicator: document.getElementById("saveIndicator"),
  logoutButton: document.getElementById("logoutButton"),
  adminNavButton: document.getElementById("adminNavButton"),
  adminDashboard: document.getElementById("admin-dashboard"),
  closeAdminDashboardButton: document.getElementById("closeAdminDashboardButton"),
  adminCreateUserForm: document.getElementById("adminCreateUserForm"),
  adminRefreshUsers: document.getElementById("adminRefreshUsers"),
  adminUsersList: document.getElementById("adminUsersList"),
  adminUserMessage: document.getElementById("adminUserMessage"),
  adminNewUsername: document.getElementById("adminNewUsername"),
  adminNewDisplayName: document.getElementById("adminNewDisplayName"),
  adminNewPassword: document.getElementById("adminNewPassword"),
  adminNewSpendLimit: document.getElementById("adminNewSpendLimit"),
  adminNewRole: document.getElementById("adminNewRole"),
  apiStatus: document.getElementById("apiStatus"),
  webSearchStatus: document.getElementById("webSearchStatus"),
  webSearchPolicy: document.getElementById("webSearchPolicy"),
  driveHeaderStatus: document.getElementById("driveHeaderStatus"),
  kbStatus: document.getElementById("kbStatus"),
  exampleStatus: document.getElementById("exampleStatus"),
  exportActions: document.getElementById("exportActions"),
  downloadWord: document.getElementById("downloadWord"),
  downloadText: document.getElementById("downloadText"),
  knowledgeUpload: document.getElementById("knowledgeUpload"),
  knowledgeFolderUpload: document.getElementById("knowledgeFolderUpload"),
  exampleUpload: document.getElementById("exampleUpload"),
  exampleFolderUpload: document.getElementById("exampleFolderUpload"),
  knowledgeList: document.getElementById("knowledgeList"),
  exampleList: document.getElementById("exampleList"),
  libraryStatus: document.getElementById("libraryStatus"),
  totalSize: document.getElementById("totalSize"),
  reviewModeButton: document.getElementById("reviewModeButton"),
  preparationModeButton: document.getElementById("preparationModeButton"),
  deliverableModeButton: document.getElementById("deliverableModeButton"),
  estimatedTaxesModeButton: document.getElementById("estimatedTaxesModeButton"),
  planningModeButton: document.getElementById("planningModeButton"),
  trackerModeButton: document.getElementById("trackerModeButton"),
  researchModeButton: document.getElementById("researchModeButton"),
  noticesModeButton: document.getElementById("noticesModeButton"),
  diagnosticsModeButton: document.getElementById("diagnosticsModeButton"),
  organizerModeButton: document.getElementById("organizerModeButton"),
  presentationsModeButton: document.getElementById("presentationsModeButton"),
  calculationsModeButton: document.getElementById("calculationsModeButton"),
  workspaceNavPanel: document.getElementById("workspaceNavPanel"),
  preparationSidebarCard: document.getElementById("preparationSidebarCard"),
  organizerSidebarCard: document.getElementById("organizerSidebarCard"),
  reviewPanel: document.getElementById("reviewForm"),
  preparerPanel: document.getElementById("preparerPanel"),
  deliverablePanel: document.getElementById("deliverablePanel"),
  estimatedTaxesPanel: document.getElementById("estimatedTaxesPanel"),
  planningPanel: document.getElementById("planningPanel"),
  trackerPanel: document.getElementById("trackerPanel"),
  researchPanel: document.getElementById("researchPanel"),
  presentationsPanel: document.getElementById("presentationsPanel"),
  calculationsPanel: document.getElementById("calculationsPanel"),
  noticesPanel: document.getElementById("noticesPanel"),
  diagnosticsPanel: document.getElementById("diagnosticsPanel"),
  organizerPanel: document.getElementById("organizerPanel"),
  prepPackageFiles: document.getElementById("prepPackageFiles"),
  prepPriorWorkpaper: document.getElementById("prepPriorWorkpaper"),
  prepFinancialReports: document.getElementById("prepFinancialReports"),
  prepPriorList: document.getElementById("prepPriorList"),
  prepReportsList: document.getElementById("prepReportsList"),
  prepPriorInlineCount: document.getElementById("prepPriorInlineCount"),
  prepReportsInlineCount: document.getElementById("prepReportsInlineCount"),
  prepPriorCount: document.getElementById("prepPriorCount"),
  prepReportCount: document.getElementById("prepReportCount"),
  qboConnectPrompt: document.getElementById("qbo-connect-prompt"),
  qboConnectedPanel: document.getElementById("qbo-connected-panel"),
  qboConnectBtn: document.getElementById("qbo-connect-btn"),
  qboDisabledMsg: document.getElementById("qbo-disabled-msg"),
  accountingSoftwareGrid: document.getElementById("accountingSoftwareGrid"),
  accountingConnectedPicker: document.getElementById("accountingConnectedPicker"),
  qboDisconnectBtn: document.getElementById("qbo-disconnect-btn"),
  qboCompanySelect: document.getElementById("qbo-company-select"),
  qboStepDates: document.getElementById("qbo-step-dates"),
  qboStepReports: document.getElementById("qbo-step-reports"),
  qboStepFetch: document.getElementById("qbo-step-fetch"),
  qboStartDate: document.getElementById("qbo-start-date"),
  qboEndDate: document.getElementById("qbo-end-date"),
  qboCustomDates: document.getElementById("qbo-custom-dates"),
  qboCategoryTabs: document.getElementById("qbo-category-tabs"),
  qboReportList: document.getElementById("qbo-report-list"),
  qboComparative: document.getElementById("qbo-comparative"),
  qboFetchBtn: document.getElementById("qbo-fetch-btn"),
  qboFetchStatus: document.getElementById("qbo-fetch-status"),
  prepValidationMessages: document.getElementById("prepValidationMessages"),
  prepStatus: document.getElementById("prepStatus"),
  prepRunHint: document.getElementById("prepRunHint"),
  runPreparer: document.getElementById("runPreparer"),
  prepResults: document.getElementById("prepResults"),
  prepExportActions: document.getElementById("prepExportActions"),
  downloadPrepWord: document.getElementById("downloadPrepWord"),
  exportPrepDrake: document.getElementById("exportPrepDrake"),
  exportPrepDrakeScript: document.getElementById("exportPrepDrakeScript"),
  prepSoftwareSelector: document.getElementById("prepSoftwareSelector"),
  prepSoftwareButton: document.getElementById("prepSoftwareButton"),
  prepSoftwareDropdown: document.getElementById("prepSoftwareDropdown"),
  prepSoftwareInfo: document.getElementById("prepSoftwareInfo"),
  prepSoftwareSource: document.getElementById("prepSoftwareSource"),
  prepSoftwareBadge: document.getElementById("prepSoftwareBadge"),
  prepSoftwareBadgeChange: document.getElementById("prepSoftwareBadgeChange"),
  firmSoftwareButton: document.getElementById("firmSoftwareButton"),
  firmSoftwareDropdown: document.getElementById("firmSoftwareDropdown"),
  firmSoftwareInfo: document.getElementById("firmSoftwareInfo"),
  databaseDefaultSoftwareStatus: document.getElementById("databaseDefaultSoftwareStatus"),
  databaseSaveDefaultSoftware: document.getElementById("databaseSaveDefaultSoftware"),
  entryGuideModal: document.getElementById("entry-guide-modal"),
  entryGuideSubtitle: document.getElementById("entry-guide-subtitle"),
  entryGuideStats: document.getElementById("entry-guide-stats"),
  entryGuideBody: document.getElementById("entry-guide-body"),
  entryGuideDownload: document.getElementById("entry-guide-download"),
  entryGuideClose: document.getElementById("entry-guide-close"),
  noticeFile: document.getElementById("noticeFile"),
  noticePriorReturn: document.getElementById("noticePriorReturn"),
  noticeFileList: document.getElementById("noticeFileList"),
  noticePriorList: document.getElementById("noticePriorList"),
  noticePriorReturnName: document.getElementById("noticePriorReturnName"),
  noticeFileCount: document.getElementById("noticeFileCount"),
  noticePriorCount: document.getElementById("noticePriorCount"),
  noticeInlineCount: document.getElementById("noticeInlineCount"),
  noticeClientFacts: document.getElementById("noticeClientFacts"),
  noticeState: document.getElementById("noticeState"),
  analyzeNotice: document.getElementById("analyzeNotice"),
  noticeStartOver: document.getElementById("noticeStartOver"),
  noticeRunHint: document.getElementById("noticeRunHint"),
  noticeResults: document.getElementById("noticeResults"),
  diagnosticsSidebarCard: document.getElementById("diagnosticsSidebarCard"),
  researchSidebarCard: document.getElementById("researchSidebarCard"),
  estimatedTaxesSidebarCard: document.getElementById("estimatedTaxesSidebarCard"),
  trackerSidebarCard: document.getElementById("trackerSidebarCard"),
  presentationsSidebarCard: document.getElementById("presentationsSidebarCard"),
  calculationsSidebarCard: document.getElementById("calculationsSidebarCard"),
  presentationsFileCount: document.getElementById("presentationsFileCount"),
  presentationsSlideCount: document.getElementById("presentationsSlideCount"),
  calculationsFileCount: document.getElementById("calculationsFileCount"),
  calculationsSheetCount: document.getElementById("calculationsSheetCount"),
  presentationsStatus: document.getElementById("presentationsStatus"),
  presentationClientName: document.getElementById("presentationClientName"),
  presentationFirmName: document.getElementById("presentationFirmName"),
  presentationPreparedBy: document.getElementById("presentationPreparedBy"),
  presentationTaxYear: document.getElementById("presentationTaxYear"),
  presentationStyle: document.getElementById("presentationStyle"),
  presentationSlideCount: document.getElementById("presentationSlideCount"),
  presentationLanguage: document.getElementById("presentationLanguage"),
  presentationIncludeAgenda: document.getElementById("presentationIncludeAgenda"),
  presentationIncludeSummary: document.getElementById("presentationIncludeSummary"),
  presentationFiles: document.getElementById("presentationFiles"),
  presentationFileList: document.getElementById("presentationFileList"),
  presentationInstructions: document.getElementById("presentationInstructions"),
  generatePresentationButton: document.getElementById("generatePresentationButton"),
  presentationResults: document.getElementById("presentationResults"),
  calculationsStatus: document.getElementById("calculationsStatus"),
  calculationClientName: document.getElementById("calculationClientName"),
  calculationTitle: document.getElementById("calculationTitle"),
  calculationIncludeSummary: document.getElementById("calculationIncludeSummary"),
  calculationIncludeDetails: document.getElementById("calculationIncludeDetails"),
  calculationIncludeCharts: document.getElementById("calculationIncludeCharts"),
  calculationGroupBy: document.getElementById("calculationGroupBy"),
  calculationFiles: document.getElementById("calculationFiles"),
  calculationFileList: document.getElementById("calculationFileList"),
  calculationInstructions: document.getElementById("calculationInstructions"),
  runCalculationButton: document.getElementById("runCalculationButton"),
  calculationResults: document.getElementById("calculationResults"),
  trackerSidebarTasks: document.getElementById("trackerSidebarTasks"),
  trackerSidebarPto: document.getElementById("trackerSidebarPto"),
  trackerSettingsButton: document.getElementById("trackerSettingsButton"),
  trackerAddTaskButton: document.getElementById("trackerAddTaskButton"),
  trackerBoard: document.getElementById("trackerBoard"),
  trackerList: document.getElementById("trackerList"),
  trackerBoardView: document.getElementById("trackerBoardView"),
  trackerListView: document.getElementById("trackerListView"),
  trackerCalendarView: document.getElementById("trackerCalendarView"),
  calendarMyView: document.getElementById("calendarMyView"),
  calendarPtoView: document.getElementById("calendarPtoView"),
  calendarTeamView: document.getElementById("calendarTeamView"),
  ptoPrevMonth: document.getElementById("ptoPrevMonth"),
  ptoNextMonth: document.getElementById("ptoNextMonth"),
  ptoMonthLabel: document.getElementById("ptoMonthLabel"),
  ptoCalendarGrid: document.getElementById("ptoCalendarGrid"),
  ptoRequestButton: document.getElementById("ptoRequestButton"),
  ptoStatsRow: document.getElementById("ptoStatsRow"),
  ptoMyList: document.getElementById("ptoMyList"),
  ptoTeamList: document.getElementById("ptoTeamList"),
  ptoAdminPanel: document.getElementById("ptoAdminPanel"),
  ptoPendingApprovals: document.getElementById("ptoPendingApprovals"),
  ptoRequireApproval: document.getElementById("ptoRequireApproval"),
  ptoMaxDays: document.getElementById("ptoMaxDays"),
  ptoSaveSettings: document.getElementById("ptoSaveSettings"),
  trackerSettingsModal: document.getElementById("trackerSettingsModal"),
  trackerSettingsClose: document.getElementById("trackerSettingsClose"),
  trackerSettingsSections: document.getElementById("trackerSettingsSections"),
  trackerSettingsStatuses: document.getElementById("trackerSettingsStatuses"),
  trackerTaskModal: document.getElementById("trackerTaskModal"),
  trackerTaskId: document.getElementById("trackerTaskId"),
  trackerTaskTitle: document.getElementById("trackerTaskTitle"),
  trackerTaskClient: document.getElementById("trackerTaskClient"),
  trackerTaskSection: document.getElementById("trackerTaskSection"),
  trackerTaskStatus: document.getElementById("trackerTaskStatus"),
  trackerTaskAssignee: document.getElementById("trackerTaskAssignee"),
  trackerTaskDue: document.getElementById("trackerTaskDue"),
  trackerTaskNotes: document.getElementById("trackerTaskNotes"),
  trackerTaskSave: document.getElementById("trackerTaskSave"),
  trackerTaskCancel: document.getElementById("trackerTaskCancel"),
  ptoRequestModal: document.getElementById("ptoRequestModal"),
  ptoCancelRequest: document.getElementById("ptoCancelRequest"),
  ptoType: document.getElementById("ptoType"),
  ptoStartDate: document.getElementById("ptoStartDate"),
  ptoEndDate: document.getElementById("ptoEndDate"),
  ptoHalfDay: document.getElementById("ptoHalfDay"),
  ptoHalfDayPeriod: document.getElementById("ptoHalfDayPeriod"),
  ptoNote: document.getElementById("ptoNote"),
  ptoDaysCounter: document.getElementById("ptoDaysCounter"),
  ptoSubmitRequest: document.getElementById("ptoSubmitRequest"),
  estSidebarMode: document.getElementById("estSidebarMode"),
  estSidebarTotal: document.getElementById("estSidebarTotal"),
  estStatus: document.getElementById("estStatus"),
  estModeEstimate: document.getElementById("estModeEstimate"),
  estModeExtension: document.getElementById("estModeExtension"),
  estimatedTaxFlow: document.getElementById("estimatedTaxFlow"),
  extensionFlow: document.getElementById("extensionFlow"),
  estClientName: document.getElementById("estClientName"),
  estClientEmail: document.getElementById("estClientEmail"),
  estEntitySelector: document.getElementById("estEntitySelector"),
  estStandardTemplateBadge: document.getElementById("estStandardTemplateBadge"),
  estDownloadBlankTemplate: document.getElementById("estDownloadBlankTemplate"),
  estEin: document.getElementById("estEin"),
  estReturnType: document.getElementById("estReturnType"),
  estTaxYear: document.getElementById("estTaxYear"),
  estState: document.getElementById("estState"),
  estFilingStatus: document.getElementById("estFilingStatus"),
  estFilingStatusField: document.getElementById("estFilingStatusField"),
  estDateOfDeathField: document.getElementById("estDateOfDeathField"),
  estDateOfDeath: document.getElementById("estDateOfDeath"),
  estQuarterSelector: document.getElementById("estQuarterSelector"),
  estQuarterEndNote: document.getElementById("estQuarterEndNote"),
  estFileDropzone: document.getElementById("estFileDropzone"),
  estFinancialFiles: document.getElementById("estFinancialFiles"),
  estFileList: document.getElementById("estFileList"),
  estTemplateDropzone: document.getElementById("estTemplateDropzone"),
  estTemplateFile: document.getElementById("estTemplateFile"),
  estTemplateStatus: document.getElementById("estTemplateStatus"),
  estPlDropzone: document.getElementById("estPlDropzone"),
  estPlFile: document.getElementById("estPlFile"),
  estPlStatus: document.getElementById("estPlStatus"),
  estPlPeriodStatus: document.getElementById("estPlPeriodStatus"),
  estPlMonthsOverride: document.getElementById("estPlMonthsOverride"),
  estBalanceSheetDropzone: document.getElementById("estBalanceSheetDropzone"),
  estBalanceSheetFile: document.getElementById("estBalanceSheetFile"),
  estBalanceSheetStatus: document.getElementById("estBalanceSheetStatus"),
  estTaxReturnsDropzone: document.getElementById("estTaxReturnsDropzone"),
  estTaxReturnFiles: document.getElementById("estTaxReturnFiles"),
  estTaxReturnsStatus: document.getElementById("estTaxReturnsStatus"),
  estAdditionalDropzone: document.getElementById("estAdditionalDropzone"),
  estAdditionalFiles: document.getElementById("estAdditionalFiles"),
  estAdditionalStatus: document.getElementById("estAdditionalStatus"),
  estFederalExtensionPayment: document.getElementById("estFederalExtensionPayment"),
  estStateExtensionPayment: document.getElementById("estStateExtensionPayment"),
  estStatePtePayment: document.getElementById("estStatePtePayment"),
  estAddStatePayment: document.getElementById("estAddStatePayment"),
  estTemplateInfo: document.getElementById("estTemplateInfo"),
  estAutoFillCarryforwards: document.getElementById("estAutoFillCarryforwards"),
  estAddDriveFiles: document.getElementById("estAddDriveFiles"),
  estPullQbo: document.getElementById("estPullQbo"),
  extensionCalculateCard: document.getElementById("extensionCalculateCard"),
  estCalculateButton: document.getElementById("estCalculateButton"),
  extCalculateButton: document.getElementById("extCalculateButton"),
  estResults: document.getElementById("estResults"),
  estDownloadWorkbook: document.getElementById("estDownloadWorkbook"),
  estCopySummary: document.getElementById("estCopySummary"),
  estEmailCard: document.getElementById("estEmailCard"),
  estEmailSubject: document.getElementById("estEmailSubject"),
  estEmailBody: document.getElementById("estEmailBody"),
  estSendEmail: document.getElementById("estSendEmail"),
  estUploadReviewedWorkbook: document.getElementById("estUploadReviewedWorkbook"),
  estReviewedWorkbookFile: document.getElementById("estReviewedWorkbookFile"),
  estReviewedWorkbookStatus: document.getElementById("estReviewedWorkbookStatus"),
  estAdditionalNotes: document.getElementById("estAdditionalNotes"),
  extAdditionalNotes: document.getElementById("extAdditionalNotes"),
  researchMessageCount: document.getElementById("researchMessageCount"),
  researchSourceCount: document.getElementById("researchSourceCount"),
  researchReturnType: document.getElementById("researchReturnType"),
  researchTaxYear: document.getElementById("researchTaxYear"),
  researchState: document.getElementById("researchState"),
  researchClientType: document.getElementById("researchClientType"),
  researchHistoryList: document.getElementById("researchHistoryList"),
  researchClearConversation: document.getElementById("researchClearConversation"),
  researchThinkingToggle: document.getElementById("researchThinkingToggle"),
  researchWebSearchToggle: document.getElementById("researchWebSearchToggle"),
  researchClearButton: document.getElementById("researchClearButton"),
  researchMessages: document.getElementById("researchMessages"),
  researchInput: document.getElementById("researchInput"),
  researchAddContext: document.getElementById("researchAddContext"),
  researchCharCount: document.getElementById("researchCharCount"),
  researchSendButton: document.getElementById("researchSendButton"),
  diagnosticsCriticalCount: document.getElementById("diagnosticsCriticalCount"),
  diagnosticsWarningCount: document.getElementById("diagnosticsWarningCount"),
  diagnosticsStatus: document.getElementById("diagnosticsStatus"),
  diagnosticsSoftware: document.getElementById("diagnosticsSoftware"),
  diagnosticsReturnType: document.getElementById("diagnosticsReturnType"),
  diagnosticsTaxYear: document.getElementById("diagnosticsTaxYear"),
  diagnosticsContext: document.getElementById("diagnosticsContext"),
  diagnosticsErrorText: document.getElementById("diagnosticsErrorText"),
  diagnosticsCharCount: document.getElementById("diagnosticsCharCount"),
  diagnosticsClearText: document.getElementById("diagnosticsClearText"),
  diagnosticsTextPane: document.getElementById("diagnosticsTextPane"),
  diagnosticsImagePane: document.getElementById("diagnosticsImagePane"),
  diagnosticsImage: document.getElementById("diagnosticsImage"),
  diagnosticsImagePreview: document.getElementById("diagnosticsImagePreview"),
  analyzeDiagnostics: document.getElementById("analyzeDiagnostics"),
  diagnosticsRunHint: document.getElementById("diagnosticsRunHint"),
  diagnosticsResults: document.getElementById("diagnosticsResults"),
  deliverableReviewState: document.getElementById("deliverableReviewState"),
  deliverableNoticeState: document.getElementById("deliverableNoticeState"),
  deliverableClientSection: document.getElementById("deliverableClientSection"),
  deliverableClientCheck: document.getElementById("deliverableClientCheck"),
  deliverableDriveClientMode: document.getElementById("deliverableDriveClientMode"),
  deliverableDriveConnectPrompt: document.getElementById("deliverableDriveConnectPrompt"),
  deliverableConnectDrive: document.getElementById("deliverableConnectDrive"),
  deliverableSelectFolder: document.getElementById("deliverableSelectFolder"),
  deliverableDriveLoaded: document.getElementById("deliverableDriveLoaded"),
  deliverableClientCompany: document.getElementById("deliverableClientCompany"),
  deliverableSaveClientInfo: document.getElementById("deliverableSaveClientInfo"),
  deliverableClientStatus: document.getElementById("deliverableClientStatus"),
  deliverableFirmName: document.getElementById("deliverableFirmName"),
  deliverableFirmAddress: document.getElementById("deliverableFirmAddress"),
  deliverableFirmPhone: document.getElementById("deliverableFirmPhone"),
  deliverableFirmEmail: document.getElementById("deliverableFirmEmail"),
  deliverablePreparerName: document.getElementById("deliverablePreparerName"),
  deliverableSaveDefaults: document.getElementById("deliverableSaveDefaults"),
  deliverableClientName: document.getElementById("deliverableClientName"),
  deliverableClientEmail: document.getElementById("deliverableClientEmail"),
  deliverableFilesSection: document.getElementById("deliverableFilesSection"),
  deliverableFilesCheck: document.getElementById("deliverableFilesCheck"),
  deliverableFileList: document.getElementById("deliverableFileList"),
  deliverableFileStatus: document.getElementById("deliverableFileStatus"),
  deliverableAddDriveFiles: document.getElementById("deliverableAddDriveFiles"),
  deliverableAddComputerFiles: document.getElementById("deliverableAddComputerFiles"),
  deliverableComputerFiles: document.getElementById("deliverableComputerFiles"),
  deliverableEmailSection: document.getElementById("deliverableEmailSection"),
  deliverableReturnType: document.getElementById("deliverableReturnType"),
  deliverableTaxYear: document.getElementById("deliverableTaxYear"),
  deliverableReviewStage: document.getElementById("deliverableReviewStage"),
  deliverableBalance: document.getElementById("deliverableBalance"),
  deliverableDeadline: document.getElementById("deliverableDeadline"),
  deliverableCustomInstructions: document.getElementById("deliverableCustomInstructions"),
  deliverableEmailTone: document.getElementById("deliverableEmailTone"),
  generateEmailDraft: document.getElementById("generateEmailDraft"),
  deliverableDraftPanel: document.getElementById("deliverableDraftPanel"),
  emailSubjectDraft: document.getElementById("emailSubjectDraft"),
  emailBodyDraft: document.getElementById("emailBodyDraft"),
  deliverableKeyPoints: document.getElementById("deliverableKeyPoints"),
  regenerateDeliverableEmail: document.getElementById("regenerateDeliverableEmail"),
  copyDeliverableEmail: document.getElementById("copyDeliverableEmail"),
  openDeliverableGmail: document.getElementById("openDeliverableGmail"),
  gmailNotConnected: document.getElementById("gmailNotConnected"),
  connectGmailButton: document.getElementById("connectGmailButton"),
  gmailSendForm: document.getElementById("gmailSendForm"),
  gmailFrom: document.getElementById("gmailFrom"),
  gmailTo: document.getElementById("gmailTo"),
  gmailCcSelf: document.getElementById("gmailCcSelf"),
  gmailAdditionalCc: document.getElementById("gmailAdditionalCc"),
  gmailAttachmentsSummary: document.getElementById("gmailAttachmentsSummary"),
  sendGmailButton: document.getElementById("sendGmailButton"),
  gmailSendResult: document.getElementById("gmailSendResult"),
  deliverableSendHistorySection: document.getElementById("deliverableSendHistorySection"),
  deliverableSendHistory: document.getElementById("deliverableSendHistory"),
  deliverableResults: document.getElementById("deliverableResults"),
  organizerPriorReturn: document.getElementById("organizerPriorReturn"),
  organizerPriorList: document.getElementById("organizerPriorList"),
  organizerPriorCount: document.getElementById("organizerPriorCount"),
  organizerQuestionCount: document.getElementById("organizerQuestionCount"),
  organizerPriorInlineCount: document.getElementById("organizerPriorInlineCount"),
  organizerClientName: document.getElementById("organizerClientName"),
  organizerTaxYear: document.getElementById("organizerTaxYear"),
  organizerReturnType: document.getElementById("organizerReturnType"),
  organizerEntityType: document.getElementById("organizerEntityType"),
  organizerAdditionalContext: document.getElementById("organizerAdditionalContext"),
  organizerValidationMessages: document.getElementById("organizerValidationMessages"),
  organizerStatus: document.getElementById("organizerStatus"),
  organizerRunHint: document.getElementById("organizerRunHint"),
  generateOrganizer: document.getElementById("generateOrganizer"),
  organizerExportActions: document.getElementById("organizerExportActions"),
  organizerPreparerView: document.getElementById("organizerPreparerView"),
  organizerClientView: document.getElementById("organizerClientView"),
  downloadOrganizerPreparer: document.getElementById("downloadOrganizerPreparer"),
  downloadOrganizerClient: document.getElementById("downloadOrganizerClient"),
  organizerResults: document.getElementById("organizerResults"),
  databaseClientList: document.getElementById("databaseClientList"),
  databaseClientSearch: document.getElementById("databaseClientSearch"),
  databaseClientDetail: document.getElementById("databaseClientDetail"),
  databaseClientTitle: document.getElementById("databaseClientTitle"),
  databaseClientSubtitle: document.getElementById("databaseClientSubtitle"),
  databaseRefreshClients: document.getElementById("databaseRefreshClients"),
  requestStepClient: document.getElementById("requestStepClient"),
  requestStepFiles: document.getElementById("requestStepFiles"),
  requestStepSend: document.getElementById("requestStepSend"),
  requestClientCheck: document.getElementById("requestClientCheck"),
  requestFilesCheck: document.getElementById("requestFilesCheck"),
  requestClientSearch: document.getElementById("requestClientSearch"),
  requestClientOptions: document.getElementById("requestClientOptions"),
  requestClientSummary: document.getElementById("requestClientSummary"),
  requestSearchInput: document.getElementById("requestSearchInput"),
  requestSearchButton: document.getElementById("requestSearchButton"),
  requestYearFilter: document.getElementById("requestYearFilter"),
  requestTypeFilter: document.getElementById("requestTypeFilter"),
  requestSourceDb: document.getElementById("requestSourceDb"),
  requestSourceDrive: document.getElementById("requestSourceDrive"),
  requestSelectAllVisible: document.getElementById("requestSelectAllVisible"),
  requestResultsList: document.getElementById("requestResultsList"),
  requestSelectedPanel: document.getElementById("requestSelectedPanel"),
  requestContextInput: document.getElementById("requestContextInput"),
  generateRequestEmail: document.getElementById("generateRequestEmail"),
  requestEmailPreview: document.getElementById("requestEmailPreview"),
  requestSendSuccess: document.getElementById("requestSendSuccess"),
  requestHistoryList: document.getElementById("requestHistoryList"),
  databaseGlobalInstructions: document.getElementById("databaseGlobalInstructions"),
  databaseGlobalSaveStatus: document.getElementById("databaseGlobalSaveStatus"),
  databaseGlobalTokenEstimate: document.getElementById("databaseGlobalTokenEstimate"),
  databaseSaveGlobalInstructions: document.getElementById("databaseSaveGlobalInstructions"),
  databaseLibraryTitle: document.getElementById("databaseLibraryTitle"),
  databaseLibraryCategory: document.getElementById("databaseLibraryCategory"),
  databaseLibraryAppliesTo: document.getElementById("databaseLibraryAppliesTo"),
  databaseLibraryAlwaysInject: document.getElementById("databaseLibraryAlwaysInject"),
  databaseLibraryContent: document.getElementById("databaseLibraryContent"),
  databaseAddLibraryItem: document.getElementById("databaseAddLibraryItem"),
  databaseLibraryList: document.getElementById("databaseLibraryList"),
  databaseRebuildDeadlines: document.getElementById("databaseRebuildDeadlines"),
  databaseDeadlineList: document.getElementById("databaseDeadlineList"),
  databaseLearningCorrection: document.getElementById("databaseLearningCorrection"),
  databaseLearningAppliesTo: document.getElementById("databaseLearningAppliesTo"),
  databaseLearningConfidence: document.getElementById("databaseLearningConfidence"),
  databaseAddLearning: document.getElementById("databaseAddLearning"),
  databaseLearningStats: document.getElementById("databaseLearningStats"),
  databaseLearningList: document.getElementById("databaseLearningList"),
  databaseFeedbackTab: document.getElementById("databaseFeedbackTab"),
  databaseFeedbackType: document.getElementById("databaseFeedbackType"),
  databaseFeedbackRating: document.getElementById("databaseFeedbackRating"),
  databaseFeedbackCorrection: document.getElementById("databaseFeedbackCorrection"),
  databaseFeedbackLearn: document.getElementById("databaseFeedbackLearn"),
  databaseSubmitFeedback: document.getElementById("databaseSubmitFeedback"),
  databaseFeedbackStats: document.getElementById("databaseFeedbackStats"),
  databaseFeedbackList: document.getElementById("databaseFeedbackList"),
};

const counters = {
  taxReturns: document.getElementById("returnCount"),
  workpapers: document.getElementById("workpaperCount"),
  documents: document.getElementById("documentCount"),
};

const inlineCounters = {
  taxReturns: document.getElementById("taxReturnsInlineCount"),
  workpapers: document.getElementById("workpapersInlineCount"),
  documents: document.getElementById("documentsInlineCount"),
};

const lists = {
  taxReturns: document.getElementById("taxReturnsList"),
  workpapers: document.getElementById("workpapersList"),
  documents: document.getElementById("documentsList"),
};

let lastReview = null;
let lastPreparerOutput = null;
let lastEntryGuideOutput = null;
let entryGuideGeneratedAt = "";
let lastNoticeAnalysis = null;
let lastDeliverableOutput = null;
let lastOrganizerOutput = null;
let lastDiagnosticsOutput = null;
let diagnosticsImageFile = null;
let organizerCurrentView = "preparer";
let qboReportsForReview = [];
let currentUsername = "";
let currentUser = { username: "", role: "user", displayName: "" };
let pendingDeliverableGmailDraft = false;
let creatingDeliverableGmailDraft = false;
let currentSessionId = localStorage.getItem("taxapp_current_session_id") || "";
let dashboardSessions = [];
let issueResolutionState = {};
let serverConfig = { apiKeyConfigured: false, webSearchEnabled: false, knowledgeBaseCount: 0, reviewExampleCount: 0 };
const workspaceSidebars = {};
const qboState = { connected: false, companies: [], selectedRealmId: "", selectedReports: new Set(), startDate: "", endDate: "", availableReports: [], activeCategory: "all", activeSoftwareId: "quickbooks", accountingAvailable: [], accountingConnected: [] };
const databaseState = { clients: [], selectedClientId: "", library: { documents: [], globalInstructions: "" }, deadlines: [], learning: { globalCorrections: [], clientCorrections: {} }, feedback: { entries: [] }, activeTab: "clients", activeClientTab: "profile" };
const requestState = { selectedClientId: "", selectedClient: null, searchResults: [], selectedFiles: [], generatedEmail: null, isSending: false };
const researchState = { history: [], messages: [], isLoading: false, useThinking: true, webSearch: true, totalSources: 0 };
const currentCalendarMonth = new Date();
const trackerState = { sections: [], statuses: [], sectionStatuses: {}, tasks: [], ptoEntries: [], ptoSettings: {}, activeView: "board", calendarView: "my", calendarMonth: new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth(), 1), ptoMonth: new Date(), collapsedSections: new Set() };
const TRACKER_SECTION_EMOJIS = [
  { code: "1f4cb", label: "Tax Returns" },
  { code: "1f4c5", label: "Estimates" },
  { code: "23f3", label: "Extensions" },
  { code: "1f4e8", label: "Deliverables" },
  { code: "1f9fe", label: "Preparation" },
  { code: "1f4c1", label: "Folder" },
  { code: "2705", label: "Checklist" },
  { code: "1f4b0", label: "Payments" },
  { code: "1f4ca", label: "Reports" },
  { code: "1f50d", label: "Review" },
  { code: "1f4dd", label: "Notes" },
  { code: "1f4ec", label: "Mail" },
  { code: "1f6a8", label: "Urgent" },
  { code: "1f4bc", label: "Client Work" },
  { code: "1f4c6", label: "Calendar" },
  { code: "1f4d8", label: "Reference" },
];
const prepState = { taxSoftware: "proconnect", taxSoftwareLabel: "ProConnect Tax" };
let availableSoftware = [];

function init() {
  Object.entries(fileInputs).forEach(([type, input]) => {
    if (!input) return;
    input.addEventListener("change", async () => {
      await addFilesToType(type, Array.from(input.files || []));
      input.value = "";
    });
  });

  els.clearFiles.addEventListener("click", resetFiles);
  els.form.addEventListener("submit", runReview);
  els.logoutButton.addEventListener("click", logout);
  els.dashboardButton?.addEventListener("click", openDashboard);
  els.closeDashboardButton?.addEventListener("click", () => { els.dashboardOverlay.hidden = true; });
  els.newReviewButton?.addEventListener("click", startNewDashboardSession);
  els.dashboardSearch?.addEventListener("input", renderDashboard);
  els.exportDataButton?.addEventListener("click", exportAllData);
  els.clearDataButton?.addEventListener("click", clearAllData);
  els.settingsExportDataButton?.addEventListener("click", exportAllData);
  els.settingsClearDataButton?.addEventListener("click", clearAllData);
  els.driveHeaderStatus.addEventListener("click", connectGoogleDrive);
  els.downloadWord.addEventListener("click", () => downloadReview("word"));
  els.downloadText?.addEventListener("click", () => downloadReview("text"));
  els.reviewModeButton.addEventListener("click", () => setWorkspaceMode("review"));
  els.preparationModeButton.addEventListener("click", () => setWorkspaceMode("preparation"));
  els.deliverableModeButton.addEventListener("click", () => setWorkspaceMode("deliverable"));
  els.estimatedTaxesModeButton?.addEventListener("click", () => setWorkspaceMode("estimated"));
  els.planningModeButton?.addEventListener("click", () => setWorkspaceMode("planning"));
  els.trackerModeButton?.addEventListener("click", () => setWorkspaceMode("tracker"));
  els.researchModeButton?.addEventListener("click", () => setWorkspaceMode("research"));
  els.noticesModeButton.addEventListener("click", () => setWorkspaceMode("notices"));
  els.diagnosticsModeButton.addEventListener("click", () => setWorkspaceMode("diagnostics"));
  els.organizerModeButton.addEventListener("click", () => setWorkspaceMode("organizer"));
  els.presentationsModeButton?.addEventListener("click", () => setWorkspaceMode("presentations"));
  els.calculationsModeButton?.addEventListener("click", () => setWorkspaceMode("calculations"));
  els.prepPackageFiles.addEventListener("change", async () => {
    preparerFiles.packageFiles = mergeFiles(preparerFiles.packageFiles, Array.from(els.prepPackageFiles.files || []));
    invalidateEntryGuideCache();
    els.prepPackageFiles.value = "";
    renderPreparerFiles();
  });
  els.qboConnectBtn?.addEventListener("click", connectQBO);
  els.qboDisconnectBtn?.addEventListener("click", disconnectQBO);
  els.qboCompanySelect?.addEventListener("change", () => onQBOCompanyChange(els.qboCompanySelect.value));
  els.qboStartDate?.addEventListener("change", () => { qboState.startDate = els.qboStartDate.value; updateQBOFetchButton(); });
  els.qboEndDate?.addEventListener("change", () => { qboState.endDate = els.qboEndDate.value; updateQBOFetchButton(); });
  els.qboComparative?.addEventListener("change", updateQBOFetchButton);
  els.qboFetchBtn?.addEventListener("click", fetchQBOReports);
  els.adminNavButton?.addEventListener("click", openAdminDashboard);
  els.closeAdminDashboardButton?.addEventListener("click", closeAdminDashboard);
  els.adminRefreshUsers?.addEventListener("click", loadAdminUsers);
  els.adminCreateUserForm?.addEventListener("submit", createAdminUser);
  document.querySelectorAll("[data-qbo-preset]").forEach((button) => button.addEventListener("click", () => setQBOPreset(button.dataset.qboPreset, button)));
  setupEstimatedTaxesEvents();
  setupTrackerEvents();
  setupPresentationEvents();
  setupCalculationEvents();
  document.querySelectorAll("[data-qbo-group]").forEach((button) => button.addEventListener("click", () => selectQBOReportGroup(button.dataset.qboGroup)));
  setupSoftwareSelectorEvents();
  els.runPreparer.addEventListener("click", runPreparerWorkflow);
  els.downloadPrepWord.addEventListener("click", downloadPreparerWord);
  els.exportPrepDrake?.addEventListener("click", exportPreparerToDrake);
  els.exportPrepDrakeScript?.addEventListener("click", downloadDrakeAutoEntryScript);
  els.entryGuideClose?.addEventListener("click", closeEntryGuide);
  els.entryGuideDownload?.addEventListener("click", () => downloadPreparerWord());
  els.noticeFile.addEventListener("change", () => {
    noticeFiles.noticeFile = Array.from(els.noticeFile.files || [])[0] || null;
    els.noticeFile.value = "";
    renderNoticeFiles();
  });
  els.noticePriorReturn.addEventListener("change", () => {
    noticeFiles.priorReturn = Array.from(els.noticePriorReturn.files || [])[0] || null;
    els.noticePriorReturn.value = "";
    renderNoticeFiles();
  });
  els.analyzeNotice.addEventListener("click", runNoticeAnalysis);
  els.noticeStartOver.addEventListener("click", resetNoticeTab);
  els.diagnosticsSoftware.addEventListener("change", updateDiagnosticsReadyState);
  els.diagnosticsReturnType.addEventListener("change", updateDiagnosticsReadyState);
  els.diagnosticsTaxYear.addEventListener("input", updateDiagnosticsReadyState);
  els.diagnosticsErrorText.addEventListener("input", updateDiagnosticsReadyState);
  els.diagnosticsContext.addEventListener("input", updateDiagnosticsReadyState);
  els.diagnosticsClearText.addEventListener("click", () => { els.diagnosticsErrorText.value = ""; updateDiagnosticsReadyState(); });
  els.diagnosticsImage.addEventListener("change", handleDiagnosticsImageChange);
  els.analyzeDiagnostics.addEventListener("click", runDiagnostics);
  document.querySelectorAll('input[name="diagnosticsInputMode"]').forEach((input) => input.addEventListener("change", updateDiagnosticsInputMode));
  setupDeliverableEvents();
  els.organizerPriorReturn.addEventListener("change", () => {
    organizerFiles.priorYearReturn = Array.from(els.organizerPriorReturn.files || [])[0] || null;
    els.organizerPriorReturn.value = "";
    renderOrganizerFiles();
  });
  els.generateOrganizer.addEventListener("click", () => runOrganizer());
  els.organizerPreparerView.addEventListener("click", () => setOrganizerView("preparer"));
  els.organizerClientView.addEventListener("click", () => setOrganizerView("client"));
  els.downloadOrganizerPreparer.addEventListener("click", () => downloadOrganizer("preparer"));
  els.downloadOrganizerClient.addEventListener("click", () => downloadOrganizer("client"));
  setupDatabaseEvents();
  ["deliverableFirmName", "deliverableFirmAddress", "deliverableFirmPhone", "deliverableFirmEmail", "deliverablePreparerName"].forEach((id) => {
    document.getElementById(id).addEventListener("input", () => {
      if (els.deliverableSaveDefaults.checked) saveFirmDefaults();
    });
  });
  document.getElementById("prepNotes").addEventListener("input", () => renderPreparerValidation(validatePreparerInputs()));
  document.getElementById("userNotes").addEventListener("input", () => renderValidation(validateBeforeReview({ showWarnings: true })));
  document.getElementById("clientFacts").addEventListener("input", () => renderValidation(validateBeforeReview({ showWarnings: true })));
  ["clientName", "entityName", "statesIncluded", "taxYear", "returnType", "reviewStage"].forEach((id) => {
    document.getElementById(id).addEventListener("input", updateStepper);
    document.getElementById(id).addEventListener("change", updateStepper);
  });
  setupFolderInputs();
  setupContextUploads();
  setupDropZones();
  setupStepNavigation();
  setupWorkspaceSidebars();
  setupDiagnosticsShortcut();
  setupResearchEvents();
  setupDriveUploadButtons();
  setupDrivePickerDomEvents();
  populateNoticeStates();

  renderFiles();
  renderPreparerFiles();
  renderNoticeFiles();
  renderOrganizerFiles();
  updateDiagnosticsReadyState();
  loadFirmDefaults();
  initSoftwareSelector();
  refreshDeliverableStatus();
  showWorkspaceSidebar("preparation");
  loadAuthStatus();
  loadServerConfig();
  refreshDriveStatus();
  loadDatabaseData();
  loadDashboardSessions().then(checkRestoreSession).catch(() => null);
  window.addEventListener("message", async (event) => {
    if (event.data?.type === "google_connected") {
      await refreshDriveStatus();
      await refreshDeliverableGmailStatus();
      showToast("Google connected.", "success");
      if (pendingDeliverableGmailDraft) await createDeliverableGmailDraft();
    }
    if (event.data?.type === "drive_connected") {
      await refreshDriveStatus();
    }
    if (event.data?.type === "qbo_connected") {
      initQBOSection();
      showToast("QuickBooks Online connected.", "success");
    }
    if (event.data?.type === "accounting_connected") {
      initQBOSection();
      showToast("Accounting software connected.", "success");
    }
  });
  initQBOSection();
}

function setWorkspaceMode(mode) {
  const isPreparation = mode === "preparation";
  const isReview = mode === "review";
  const isDeliverable = mode === "deliverable";
  const isEstimated = mode === "estimated";
  const isPlanning = mode === "planning";
  const isTracker = mode === "tracker";
  const isResearch = mode === "research";
  const isPresentations = mode === "presentations";
  const isCalculations = mode === "calculations";
  const isNotices = mode === "notices";
  const isDiagnostics = mode === "diagnostics";
  const isOrganizer = mode === "organizer";
  els.preparationModeButton.classList.toggle("active", isPreparation);
  els.reviewModeButton.classList.toggle("active", isReview);
  els.deliverableModeButton.classList.toggle("active", isDeliverable);
  els.estimatedTaxesModeButton?.classList.toggle("active", isEstimated);
  els.planningModeButton?.classList.toggle("active", isPlanning);
  els.trackerModeButton?.classList.toggle("active", isTracker);
  els.researchModeButton?.classList.toggle("active", isResearch);
  els.noticesModeButton.classList.toggle("active", isNotices);
  els.diagnosticsModeButton.classList.toggle("active", isDiagnostics);
  els.organizerModeButton.classList.toggle("active", isOrganizer);
  els.presentationsModeButton?.classList.toggle("active", isPresentations);
  els.calculationsModeButton?.classList.toggle("active", isCalculations);
  els.preparerPanel.hidden = !isPreparation;
  els.reviewPanel.hidden = !isReview;
  els.deliverablePanel.hidden = !isDeliverable;
  if (els.estimatedTaxesPanel) els.estimatedTaxesPanel.hidden = !isEstimated;
  if (els.planningPanel) els.planningPanel.hidden = !isPlanning;
  if (els.trackerPanel) els.trackerPanel.hidden = !isTracker;
  if (els.researchPanel) els.researchPanel.hidden = !isResearch;
  if (els.presentationsPanel) els.presentationsPanel.hidden = !isPresentations;
  if (els.calculationsPanel) els.calculationsPanel.hidden = !isCalculations;
  els.noticesPanel.hidden = !isNotices;
  els.diagnosticsPanel.hidden = !isDiagnostics;
  els.organizerPanel.hidden = !isOrganizer;
  els.preparerPanel.classList.toggle("active", isPreparation);
  els.reviewPanel.classList.toggle("active", isReview);
  els.deliverablePanel.classList.toggle("active", isDeliverable);
  els.estimatedTaxesPanel?.classList.toggle("active", isEstimated);
  els.planningPanel?.classList.toggle("active", isPlanning);
  els.trackerPanel?.classList.toggle("active", isTracker);
  els.researchPanel?.classList.toggle("active", isResearch);
  els.presentationsPanel?.classList.toggle("active", isPresentations);
  els.calculationsPanel?.classList.toggle("active", isCalculations);
  els.noticesPanel.classList.toggle("active", isNotices);
  els.diagnosticsPanel.classList.toggle("active", isDiagnostics);
  els.organizerPanel.classList.toggle("active", isOrganizer);
  showWorkspaceSidebar(mode);
  if (isDeliverable) refreshDeliverableStatus();
  if (isEstimated) syncEstimatedTaxesSharedFields();
  if (isPlanning) initPlanningStudio();
  if (isTracker) loadTrackerData();
  if (isResearch) hydrateResearchContextFromCurrentSession();
  if (isPresentations) syncPresentationSharedFields();
  if (isCalculations) syncCalculationSharedFields();
  if (isOrganizer) loadDatabaseData();
}

function setupWorkspaceSidebars() {
  workspaceSidebars.preparation = els.preparationSidebarCard;
  workspaceSidebars.review = els.reviewPanel.querySelector(".stepper");
  workspaceSidebars.deliverable = els.deliverablePanel.querySelector(".stepper");
  workspaceSidebars.estimated = els.estimatedTaxesSidebarCard;
  workspaceSidebars.tracker = els.trackerSidebarCard;
  workspaceSidebars.research = els.researchSidebarCard;
  workspaceSidebars.presentations = els.presentationsSidebarCard;
  workspaceSidebars.calculations = els.calculationsSidebarCard;
  workspaceSidebars.notices = els.noticesPanel.querySelector(".stepper");
  workspaceSidebars.diagnostics = els.diagnosticsSidebarCard;
  workspaceSidebars.organizer = els.organizerSidebarCard;

  Object.entries(workspaceSidebars).forEach(([mode, sidebar]) => {
    if (!sidebar) return;
    sidebar.dataset.workspaceSidebar = mode;
    sidebar.classList.add("workspace-sidebar-card");
    els.workspaceNavPanel.appendChild(sidebar);
  });
}

function showWorkspaceSidebar(mode) {
  Object.entries(workspaceSidebars).forEach(([sidebarMode, sidebar]) => {
    if (!sidebar) return;
    sidebar.hidden = sidebarMode !== mode;
  });
}

function readFirmDefaults() {
  try {
    return JSON.parse(localStorage.getItem("taxapp_firm_defaults") || "{}");
  } catch (_) {
    return {};
  }
}

function writeFirmDefaults(defaults) {
  localStorage.setItem("taxapp_firm_defaults", JSON.stringify(defaults || {}));
}

function setupPresentationEvents() {
  els.presentationFiles?.addEventListener("change", () => {
    presentationState.files = mergeFiles(presentationState.files, Array.from(els.presentationFiles.files || []));
    els.presentationFiles.value = "";
    renderPresentationFiles();
  });
  els.generatePresentationButton?.addEventListener("click", generatePresentation);
  els.presentationSlideCount?.addEventListener("change", () => {
    if (els.presentationsSlideCount) els.presentationsSlideCount.textContent = els.presentationSlideCount.value === "auto" ? "Auto" : els.presentationSlideCount.value;
  });
  document.querySelectorAll("[data-presentation-template]").forEach((button) => {
    button.addEventListener("click", () => applyPresentationTemplate(button.dataset.presentationTemplate));
  });
}

function setupCalculationEvents() {
  els.calculationFiles?.addEventListener("change", () => {
    calculationState.files = mergeFiles(calculationState.files, Array.from(els.calculationFiles.files || []));
    els.calculationFiles.value = "";
    renderCalculationFiles();
  });
  els.runCalculationButton?.addEventListener("click", runMiscCalculation);
  document.querySelectorAll("[data-calculation-template]").forEach((button) => {
    button.addEventListener("click", () => applyCalculationTemplate(button.dataset.calculationTemplate));
  });
}

function syncPresentationSharedFields() {
  if (els.presentationClientName && !els.presentationClientName.value) els.presentationClientName.value = document.getElementById("clientName")?.value || "";
  if (els.presentationTaxYear && !els.presentationTaxYear.value) els.presentationTaxYear.value = document.getElementById("taxYear")?.value || new Date().getFullYear();
  const defaults = readFirmDefaults();
  if (els.presentationFirmName && !els.presentationFirmName.value) els.presentationFirmName.value = defaults.firmName || els.deliverableFirmName?.value || "";
  if (els.presentationPreparedBy && !els.presentationPreparedBy.value) els.presentationPreparedBy.value = defaults.preparerName || currentUser.displayName || currentUsername || "";
}

function syncCalculationSharedFields() {
  if (els.calculationClientName && !els.calculationClientName.value) els.calculationClientName.value = document.getElementById("clientName")?.value || "";
  if (els.calculationTitle && !els.calculationTitle.value) els.calculationTitle.value = "Misc Calculation";
}

function renderPresentationFiles() {
  renderGeneratorFileList(els.presentationFileList, presentationState.files, "presentation");
  if (els.presentationsFileCount) els.presentationsFileCount.textContent = String(presentationState.files.length);
}

function renderCalculationFiles() {
  renderGeneratorFileList(els.calculationFileList, calculationState.files, "calculation");
  if (els.calculationsFileCount) els.calculationsFileCount.textContent = String(calculationState.files.length);
}

function renderGeneratorFileList(container, files, mode) {
  if (!container) return;
  if (!files.length) {
    container.innerHTML = `<div class="generator-empty">No files uploaded yet.</div>`;
    return;
  }
  const roleOptions = mode === "presentation"
    ? [["financial_data", "Financial Data"], ["supporting_doc", "Supporting Doc"], ["image", "Image"], ["logo", "Logo"], ["other", "Other"]]
    : [["source_data", "Source Data"], ["reference", "Reference"], ["supporting", "Supporting"], ["other", "Other"]];
  container.innerHTML = files.map((file, index) => `
    <div class="generator-file-row">
      <span class="file-icon">${requestFileIcon(file.name, file.type || guessMediaType(file.name))}</span>
      <span class="generator-file-name">${escapeHtml(displayFileName(file))}</span>
      <span class="muted">${formatBytes(file.size || 0)}</span>
      <select data-generator-role="${mode}" data-index="${index}">
        ${roleOptions.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
      </select>
      <button type="button" data-generator-remove="${mode}" data-index="${index}">Remove</button>
    </div>`).join("");
  container.querySelectorAll("[data-generator-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      if (mode === "presentation") presentationState.files.splice(index, 1);
      else calculationState.files.splice(index, 1);
      mode === "presentation" ? renderPresentationFiles() : renderCalculationFiles();
    });
  });
}

function applyPresentationTemplate(template) {
  const templates = {
    "tax-planning": "Create a client presentation explaining the tax planning opportunities, estimated tax impact, open decisions, and recommended next steps.",
    "year-end": "Create a year-end client summary covering financial results, tax position, key deadlines, and documents still needed.",
    "qbo-results": "Create a financial results deck using the uploaded reports. Highlight revenue, expenses, net income, balance sheet changes, and management takeaways.",
    "action-plan": "Create an action plan presentation with priorities, owner, deadline, and expected tax impact for each action item.",
  };
  if (els.presentationInstructions) els.presentationInstructions.value = templates[template] || "";
}

function applyCalculationTemplate(template) {
  const templates = {
    "1099 Summary": "I have attached multiple 1099 documents. Create a summary showing payer name, payer EIN, income by box type, federal tax withheld, foreign tax paid, and a grand total row. Flag any payer where federal tax withheld is $0 and income exceeds $1,000.",
    "P&L Comparison": "Compare the two P&L periods attached. Show each line item with prior period amount, current period amount, dollar change, and percentage change. Sort by absolute dollar change descending. Flag items where change exceeds 20%.",
    "1099-B Dispositions": "Summarize all stock dispositions from the attached 1099-B documents. Group by short-term and long-term. Show proceeds, cost basis, gain or loss, and net. Flag wash sales.",
    "W-2 Summary": "Summarize all W-2s by employer. Show wages, federal withholding, Social Security wages, Medicare wages, state wages, and state withholding. Include totals.",
    "Bank Reconciliation": "Reconcile the bank statement activity to the uploaded ledger. Show deposits, withdrawals, outstanding items, adjusted balance, and discrepancies.",
    "K-1 Summary": "Summarize all K-1 amounts by entity and box. Group ordinary income, guaranteed payments, separately stated items, credits, and state items.",
  };
  if (els.calculationInstructions) els.calculationInstructions.value = templates[template] || "";
  if (els.calculationTitle && template) els.calculationTitle.value = template;
}

async function generatePresentation() {
  if (!els.presentationInstructions?.value.trim()) { showToast("Write presentation instructions first.", "warning"); return; }
  setGeneratorBusy("presentations", true, "Generating PowerPoint...");
  try {
    const files = await filesForGenerator(presentationState.files, "presentation");
    const data = await fetchJson("/api/presentations/generate", {
      instructions: els.presentationInstructions.value.trim(),
      style: els.presentationStyle.value,
      clientName: els.presentationClientName.value,
      firmName: els.presentationFirmName.value,
      preparedBy: els.presentationPreparedBy.value,
      taxYear: els.presentationTaxYear.value,
      files,
      slideCount: els.presentationSlideCount.value,
      includeAgenda: els.presentationIncludeAgenda.checked,
      includeSummary: els.presentationIncludeSummary.checked,
      language: els.presentationLanguage.value,
    });
    presentationState.lastResult = data;
    if (els.presentationsSlideCount) els.presentationsSlideCount.textContent = String(data.slideCount || "Auto");
    renderPresentationResult(data);
  } catch (error) {
    renderGeneratorError(els.presentationResults, error);
  } finally {
    setGeneratorBusy("presentations", false, "Ready");
  }
}

async function runMiscCalculation() {
  if (!els.calculationInstructions?.value.trim()) { showToast("Write calculation instructions first.", "warning"); return; }
  setGeneratorBusy("calculations", true, "Running calculation...");
  try {
    const files = await filesForGenerator(calculationState.files, "calculation");
    const data = await fetchJson("/api/calculations/run", {
      instructions: els.calculationInstructions.value.trim(),
      clientName: els.calculationClientName.value,
      calculationTitle: els.calculationTitle.value,
      files,
      outputFormat: {
        includeSummarySheet: els.calculationIncludeSummary.checked,
        includeDetailSheets: els.calculationIncludeDetails.checked,
        includeCharts: els.calculationIncludeCharts.checked,
        groupBy: els.calculationGroupBy.value || null,
      },
    });
    calculationState.lastResult = data;
    if (els.calculationsSheetCount) els.calculationsSheetCount.textContent = String(data.sheetNames?.length || 0);
    renderCalculationResult(data);
  } catch (error) {
    renderGeneratorError(els.calculationResults, error);
  } finally {
    setGeneratorBusy("calculations", false, "Ready");
  }
}

async function filesForGenerator(files, mode) {
  const roleSelects = document.querySelectorAll(`[data-generator-role="${mode}"]`);
  const roles = new Map(Array.from(roleSelects).map((select) => [Number(select.dataset.index), select.value]));
  const output = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    let prepared = {};
    try {
      prepared = await prepareFileForReview({ file, type: mode === "presentation" ? "presentationSource" : "calculationSource" });
    } catch (error) {
      console.warn("Generator file preparation failed:", error);
    }
    output.push({
      name: displayFileName(file),
      type: file.type || guessMediaType(file.name),
      content: await readAsBase64(file),
      role: roles.get(index) || (mode === "presentation" ? "supporting_doc" : "source_data"),
      encoding: prepared.encoding || "base64",
      text: prepared.text || "",
      workbookTemplate: prepared.workbookTemplate || null,
      workbookTemplates: prepared.workbookTemplates || [],
    });
  }
  return output;
}

async function fetchJson(url, payload) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error || "Request failed.");
  return data;
}

function setGeneratorBusy(kind, busy, text) {
  const isPresentation = kind === "presentations";
  const button = isPresentation ? els.generatePresentationButton : els.runCalculationButton;
  const status = isPresentation ? els.presentationsStatus : els.calculationsStatus;
  if (button) button.disabled = busy;
  if (status) status.textContent = text;
}

function renderPresentationResult(data) {
  if (!els.presentationResults) return;
  els.presentationResults.innerHTML = `
    <article class="generator-result-card">
      <span class="tag success">PowerPoint ready</span>
      <h3>${escapeHtml(data.filename || "Client presentation.pptx")}</h3>
      <p>${Number(data.slideCount || 0)} slide(s) generated.</p>
      <div class="slide-outline">
        ${(data.slideOutline || []).map((slide) => `<div><strong>${slide.slideNumber}. ${escapeHtml(slide.title || "Slide")}</strong><span>${escapeHtml(slide.type || "")}</span></div>`).join("")}
      </div>
      <button id="downloadGeneratedPresentation" class="primary-button small-button" type="button">Download PowerPoint</button>
    </article>`;
  document.getElementById("downloadGeneratedPresentation")?.addEventListener("click", () => {
    downloadBase64File(data.filename, data.contentBase64, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  });
}

function renderCalculationResult(data) {
  if (!els.calculationResults) return;
  els.calculationResults.innerHTML = `
    <article class="generator-result-card">
      <span class="tag success">Excel workbook ready</span>
      <h3>${escapeHtml(data.filename || "Calculations.xlsx")}</h3>
      <p>${escapeHtml(data.executiveSummary || "Structured calculation workbook generated.")}</p>
      <div class="sheet-chip-row">${(data.sheetNames || []).map((name) => `<span>${escapeHtml(name)}</span>`).join("")}</div>
      ${data.flagCount ? `<p class="warning-text">${data.flagCount} flag(s) included in the workbook.</p>` : ""}
      <button id="downloadGeneratedCalculation" class="primary-button small-button" type="button">Download Excel</button>
    </article>`;
  document.getElementById("downloadGeneratedCalculation")?.addEventListener("click", () => {
    if (data.contentBase64) downloadBase64File(data.filename, data.contentBase64, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    else if (data.workbook) downloadWorkbook(data.filename, data.workbook);
  });
}

function renderGeneratorError(container, error) {
  if (!container) return;
  container.innerHTML = `<article class="generator-result-card error"><span class="tag danger">Error</span><p>${escapeHtml(error.message || String(error))}</p></article>`;
}

function downloadBase64File(fileName, base64, mimeType) {
  const binary = atob(String(base64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  downloadBlob(fileName || "download", bytes, mimeType);
}

function setupEstimatedTaxesEvents() {
  els.estEntitySelector?.querySelectorAll("[data-est-entity]").forEach((button) => {
    button.addEventListener("click", () => updateEstimatedEntityType(button.dataset.estEntity || "1040"));
  });
  els.estQuarterSelector?.querySelectorAll("[data-quarter]").forEach((button) => {
    button.addEventListener("click", () => updateEstimatedQuarter(button.dataset.quarter || "Q1"));
  });
  ["estTaxYear", "estState", "estAdditionalNotes", "estPlMonthsOverride", "estClientName", "estClientEmail",
    "estQ1Federal", "estQ2Federal", "estQ3Federal", "estFederalExtensionPayment", "estPriorOverFederal",
    "estQ1State", "estQ2State", "estQ3State", "estStateExtensionPayment", "estPriorOverState", "estStatePtePayment"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", updateEstimatedCalculateAvailability);
    document.getElementById(id)?.addEventListener("change", () => {
      if (id === "estTaxYear") updateEstimatedQuarter(estimatedTaxesState.quarter);
      updateEstimatedCalculateAvailability();
    });
  });
  setupEstimatedUploadZone("template", els.estTemplateDropzone, els.estTemplateFile);
  setupEstimatedUploadZone("pl", els.estPlDropzone, els.estPlFile);
  setupEstimatedUploadZone("balanceSheet", els.estBalanceSheetDropzone, els.estBalanceSheetFile);
  setupEstimatedUploadZone("taxReturns", els.estTaxReturnsDropzone, els.estTaxReturnFiles);
  setupEstimatedUploadZone("additional", els.estAdditionalDropzone, els.estAdditionalFiles);
  els.estAddStatePayment?.addEventListener("click", () => showToast("Additional state columns are next. For now, run one state at a time.", "info"));
  els.estAddDriveFiles?.addEventListener("click", openEstimatedDrivePicker);
  els.estDownloadBlankTemplate?.addEventListener("click", downloadEstimatedBlankTemplate);
  els.estCalculateButton?.addEventListener("click", calculateEstimatedTaxesOrExtension);
  els.estDownloadWorkbook?.addEventListener("click", downloadEstimatedTaxesWorkbook);
  els.estCopySummary?.addEventListener("click", copyEstimatedTaxesSummary);
  els.estSendEmail?.addEventListener("click", sendEstimatedTaxesEmail);
  els.estUploadReviewedWorkbook?.addEventListener("click", () => els.estReviewedWorkbookFile?.click());
  els.estReviewedWorkbookFile?.addEventListener("change", () => {
    const file = Array.from(els.estReviewedWorkbookFile.files || [])[0];
    if (file) {
      estimatedTaxesState.reviewedWorkpaper = file;
      if (els.estReviewedWorkbookStatus) els.estReviewedWorkbookStatus.textContent = `${displayFileName(file)} ready to attach.`;
      showToast("Reviewed workbook uploaded. Gmail draft will use this file.", "success");
    }
    els.estReviewedWorkbookFile.value = "";
  });
  updateEstimatedEntityType(estimatedTaxesState.entityType);
  updateEstimatedQuarter(estimatedTaxesState.quarter);
  renderEstimatedTaxFiles();
  updateEstimatedCalculateAvailability();
}

function updateEstimatedEntityType(entityType) {
  estimatedTaxesState.entityType = normalizeEstimatedEntityType(entityType);
  els.estEntitySelector?.querySelectorAll("[data-est-entity]").forEach((button) => {
    const active = normalizeEstimatedEntityType(button.dataset.estEntity) === estimatedTaxesState.entityType;
    button.classList.toggle("active", active);
    button.classList.toggle("selected", active);
  });
  const label = estimatedEntityLabel(estimatedTaxesState.entityType);
  if (els.estStandardTemplateBadge) els.estStandardTemplateBadge.textContent = estimatedTaxesState.templateFile
    ? `Using custom template for ${label}`
    : `Using standard ${label} template`;
  if (els.estDownloadBlankTemplate) els.estDownloadBlankTemplate.textContent = `Download blank template for ${label}`;
  updateEstimatedCalculateAvailability();
}

function normalizeEstimatedEntityType(entityType) {
  const value = String(entityType || "1040").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (value === "1120S") return "1120S";
  if (["1040", "1065", "1120", "1041"].includes(value)) return value;
  return "1040";
}

function estimatedEntityLabel(entityType) {
  return ({ "1040": "1040", "1120S": "1120-S", "1065": "1065", "1120": "1120", "1041": "1041" })[normalizeEstimatedEntityType(entityType)] || "1040";
}

function downloadEstimatedBlankTemplate() {
  const entity = normalizeEstimatedEntityType(estimatedTaxesState.entityType).toLowerCase();
  window.open(`${API_BASE_URL}/api/estimated-taxes/templates/${encodeURIComponent(entity)}`, "_blank", "noopener");
}

function setEstimatedTaxesMode() {
  estimatedTaxesState.mode = "estimate";
  if (els.estimatedTaxFlow) els.estimatedTaxFlow.hidden = false;
  if (els.extensionFlow) els.extensionFlow.hidden = true;
  if (els.extensionCalculateCard) els.extensionCalculateCard.hidden = true;
  if (els.estSidebarMode) els.estSidebarMode.textContent = "Estimate";
  updateEstimatedActionLabels();
  updateEstimatedCalculateAvailability();
}

function updateEstimatedQuarter(quarter) {
  estimatedTaxesState.quarter = quarter || "Q1";
  els.estQuarterSelector?.querySelectorAll("[data-quarter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.quarter === estimatedTaxesState.quarter);
    button.classList.toggle("selected", button.dataset.quarter === estimatedTaxesState.quarter);
  });
  if (!els.estQuarterEndNote) return;
  const year = Number(estFieldValue("estTaxYear") || new Date().getFullYear());
  const ends = { Q1: "March 31", Q2: "June 30", Q3: "September 30", Q4: "December 31", ANNUAL: "the projected full year" };
  els.estQuarterEndNote.textContent = estimatedTaxesState.quarter === "ANNUAL"
    ? `Estimate mode creates a full-year projection for ${year}.`
    : `${estimatedTaxesState.quarter} uses current-year financials through ${ends[estimatedTaxesState.quarter] || "the selected period"} ${year}.`;
}

function updateEstimatedFieldsVisibility() {
  const returnType = estFieldValue("estReturnType");
  if (els.estFilingStatusField) els.estFilingStatusField.hidden = returnType !== "1040";
  if (els.estDateOfDeathField) els.estDateOfDeathField.hidden = returnType !== "706";
  updateEstimatedQuarter(estimatedTaxesState.quarter);
}

function updateEstimatedActionLabels() {
  if (els.estCalculateButton) els.estCalculateButton.textContent = "Fill Workpaper";
  if (els.estStatus) {
    els.estStatus.textContent = estimatedTaxesState.plFile
      ? "Ready to fill the selected template."
      : "Select entity type, period, and upload the current-year P&L.";
  }
}

function syncEstimatedTaxesSharedFields() {
  const metadata = getMetadata?.() || {};
  if (els.estClientName && !els.estClientName.value) els.estClientName.value = metadata.clientName || metadata.entityName || "";
  if (els.estReturnType && metadata.returnType) els.estReturnType.value = metadata.returnType;
  if (els.estTaxYear && metadata.taxYear) els.estTaxYear.value = metadata.taxYear;
  if (els.estState && metadata.statesIncluded) els.estState.value = String(metadata.statesIncluded).split(/[,; ]+/)[0].toUpperCase();
  updateEstimatedFieldsVisibility();
}

function estFieldValue(id) {
  return String(document.getElementById(id)?.value || "").trim();
}

function estNumber(id) {
  const raw = estFieldValue(id).replace(/[$,]/g, "");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function setupEstimatedUploadZone(zone, dropzone, input) {
  if (!dropzone || !input) return;
  input.addEventListener("change", () => {
    setEstimatedZoneFiles(zone, Array.from(input.files || []));
    input.value = "";
  });
  dropzone.addEventListener("click", (event) => {
    if (event.target?.tagName === "INPUT") return;
    input.click();
  });
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });
  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add("dragging");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove("dragging");
    });
  });
  dropzone.addEventListener("drop", (event) => setEstimatedZoneFiles(zone, Array.from(event.dataTransfer?.files || [])));
}

function setEstimatedZoneFiles(zone, files) {
  if (!files.length) return;
  if (zone === "template") estimatedTaxesState.templateFile = files[0];
  if (zone === "pl") {
    estimatedTaxesState.plFile = files[0];
    estimatedTaxesState.plPeriod = null;
    detectEstimatedPlPeriod(files[0]);
  }
  if (zone === "balanceSheet") estimatedTaxesState.balanceSheetFile = files[0];
  if (zone === "taxReturns") {
    const existing = new Set(estimatedTaxesState.taxReturnFiles.map(fileKey));
    files.forEach((file) => {
      if (!existing.has(fileKey(file))) estimatedTaxesState.taxReturnFiles.push(file);
    });
  }
  if (zone === "additional") {
    const existing = new Set(estimatedTaxesState.additionalFiles.map(fileKey));
    files.forEach((file) => {
      if (!existing.has(fileKey(file))) estimatedTaxesState.additionalFiles.push(file);
    });
  }
  renderEstimatedTaxFiles();
  updateEstimatedEntityType(estimatedTaxesState.entityType);
  updateEstimatedCalculateAvailability();
}

function openEstimatedDrivePicker() {
  if (typeof DrivePicker === "undefined") {
    showToast("Google Drive picker is not available in this session.", "warning");
    return;
  }
  DrivePicker.open({
    title: "Select Estimated Tax Files",
    subtitle: "Choose templates, P&L reports, balance sheets, and returns.",
    allowedTypes: ["pdf", "xlsx", "csv"],
    multiSelect: true,
    onFilesSelected: (files) => addEstimatedDriveFiles(files || []),
  });
}

function addEstimatedDriveFiles(files) {
  let placed = 0;
  for (const file of files) {
    const name = String(file.name || "").toLowerCase();
    if (!estimatedTaxesState.templateFile && /(template|workpaper|estimate|estimated|q[1-4])/.test(name)) {
      estimatedTaxesState.templateFile = file;
      placed += 1;
    } else if (!estimatedTaxesState.plFile && /(p&l|p\s*l|profit|loss|income statement|statement of operations)/.test(name)) {
      estimatedTaxesState.plFile = file;
      placed += 1;
      detectEstimatedPlPeriod(file);
    } else if (!estimatedTaxesState.balanceSheetFile && /(balance|bs|statement of financial position)/.test(name)) {
      estimatedTaxesState.balanceSheetFile = file;
      placed += 1;
    } else if (/(w-?2|1099|notice|cp\d|letter)/.test(name)) {
      const existing = new Set(estimatedTaxesState.additionalFiles.map(fileKey));
      if (!existing.has(fileKey(file))) estimatedTaxesState.additionalFiles.push(file);
      placed += 1;
    } else if (/(return|1040|1120|1065|990|form)/.test(name) || /\.pdf$/i.test(name)) {
      const existing = new Set(estimatedTaxesState.taxReturnFiles.map(fileKey));
      if (!existing.has(fileKey(file))) estimatedTaxesState.taxReturnFiles.push(file);
      placed += 1;
    } else {
      const existing = new Set(estimatedTaxesState.additionalFiles.map(fileKey));
      if (!existing.has(fileKey(file))) estimatedTaxesState.additionalFiles.push(file);
      placed += 1;
    }
  }
  renderEstimatedTaxFiles();
  updateEstimatedCalculateAvailability();
  showToast(placed ? `${placed} Drive file(s) added to Estimates.` : "No Drive files were selected.", placed ? "success" : "warning");
}

async function detectEstimatedPlPeriod(file) {
  if (!file || !els.estPlPeriodStatus) return;
  els.estPlPeriodStatus.hidden = false;
  els.estPlPeriodStatus.textContent = "Detecting P&L period...";
  try {
    const prepared = file.content && !file.arrayBuffer ? { text: file.text || "" } : await prepareFileForReview({ file, type: "estimatedTaxes" });
    const response = await fetch(`${API_BASE_URL}/api/estimated-taxes/detect-period`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: displayFileName(file),
        type: file.type || guessMediaType(file.name),
        content: file.content || await readAsBase64(file),
        text: prepared.text || "",
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not detect period.");
    estimatedTaxesState.plPeriod = data;
    if (data.detectedMonths && els.estPlMonthsOverride && !els.estPlMonthsOverride.value) els.estPlMonthsOverride.value = data.detectedMonths;
    els.estPlPeriodStatus.innerHTML = `
      <strong>Detected period:</strong> ${escapeHtml(data.detectedPeriod || "Not detected")}<br>
      <strong>Months:</strong> ${escapeHtml(data.detectedMonths || "Unknown")} ·
      <strong>Annualization factor:</strong> ${escapeHtml(data.annFactor || "Unknown")}
    `;
  } catch (error) {
    estimatedTaxesState.plPeriod = null;
    els.estPlPeriodStatus.textContent = `Period detection failed: ${error.message}. Enter months manually before generating.`;
  }
}

function addEstimatedTaxFiles(files) {
  if (!files.length) return;
  const wrapped = files.map((file) => ({ file, role: detectEstimatedFileRole(file), id: fileKey(file) }));
  const existing = new Set(estimatedTaxesState.files.map((item) => item.id));
  wrapped.forEach((item) => {
    if (!existing.has(item.id)) estimatedTaxesState.files.push(item);
  });
  renderEstimatedTaxFiles();
  updateEstimatedCalculateAvailability();
}

function detectEstimatedFileRole(file) {
  const name = String(displayFileName(file) || "").toLowerCase();
  const taxYear = Number(estFieldValue("estTaxYear") || new Date().getFullYear());
  const priorYear = taxYear ? String(taxYear - 1) : "";
  if (/1040|individual|schedule\s*a|schedule\s*2/i.test(name)) return "prior_year_return_1040";
  if (/1120-?s|s[\s-]?corp|k-?1/i.test(name)) return "prior_year_return_1120s";
  if (/\bw-?2\b|wage|withholding|paystub|payroll/i.test(name)) return "current_year_w2";
  if (/(p&l|profit|loss|income statement|statement of operations)/i.test(name)) return "current_year_pl";
  if (/\b(workpaper|template|wp|q1|q2|q3|q4)\b/i.test(name) || (priorYear && name.includes(priorYear))) return "prior_year_template";
  if (/(p&l|profit|loss|balance|trial|statement|ledger|qbo|quickbooks|xero)/i.test(name)) return "financial_report";
  return "financial_report";
}

function detectEstimatedPreparedFileRole(file, prepared = {}, selectedRole = "financial_report") {
  const explicit = String(selectedRole || "financial_report");
  if (!["financial_report", "other", ""].includes(explicit)) return explicit;
  const name = String(displayFileName(file) || "").toLowerCase();
  const text = String(prepared.text || "").slice(0, 12000).toLowerCase();
  const haystack = `${name}\n${text}`;
  const taxYear = Number(estFieldValue("estTaxYear") || new Date().getFullYear());
  const priorYear = taxYear ? String(taxYear - 1) : "";
  if (/form\s*1040|u\.?s\.?\s+individual income tax return|schedule\s+a|schedule\s+2/i.test(haystack)) return "prior_year_return_1040";
  if (/form\s*1120-?s|s corporation|schedule\s+k-?1/i.test(haystack)) return "prior_year_return_1120s";
  if (/\bw-?2\b|wage and tax statement|box\s*1|box\s*2|box\s*16|box\s*17|paystub|payroll/i.test(haystack)) return "current_year_w2";
  if (/p\s*&\s*l|profit\s+(and|&)\s+loss|income statement|statement of operations|year to date|ytd/i.test(haystack)) return "current_year_pl";
  if (/\b(estimated tax|estimate|workpaper|template|q[1-4])\b/i.test(haystack) && (priorYear && haystack.includes(priorYear) || /\bprior|template\b/i.test(haystack))) return "prior_year_template";
  return explicit || "financial_report";
}

function renderEstimatedTaxFiles() {
  renderEstimatedZoneStatus(
    "template",
    estimatedTaxesState.templateFile,
    els.estTemplateStatus,
    els.estTemplateDropzone,
    `Using standard ${estimatedEntityLabel(estimatedTaxesState.entityType)} template.`
  );
  renderEstimatedZoneStatus("pl", estimatedTaxesState.plFile, els.estPlStatus, els.estPlDropzone, "No P&L uploaded.");
  renderEstimatedZoneStatus("balanceSheet", estimatedTaxesState.balanceSheetFile, els.estBalanceSheetStatus, els.estBalanceSheetDropzone, "No balance sheet uploaded.");
  if (els.estTaxReturnsStatus) {
    els.estTaxReturnsStatus.innerHTML = estimatedTaxesState.taxReturnFiles.length
      ? estimatedTaxesState.taxReturnFiles.map((file, index) => `
        <span class="est-zone-file">${escapeHtml(displayFileName(file))} <button type="button" data-est-return-remove="${index}">Remove</button></span>
      `).join("")
      : "No returns uploaded.";
    els.estTaxReturnsStatus.querySelectorAll("[data-est-return-remove]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        estimatedTaxesState.taxReturnFiles.splice(Number(button.dataset.estReturnRemove), 1);
        renderEstimatedTaxFiles();
        updateEstimatedCalculateAvailability();
      });
    });
  }
  els.estTaxReturnsDropzone?.classList.toggle("filled", estimatedTaxesState.taxReturnFiles.length > 0);
  if (els.estAdditionalStatus) {
    els.estAdditionalStatus.innerHTML = estimatedTaxesState.additionalFiles.length
      ? estimatedTaxesState.additionalFiles.map((file, index) => `
        <span class="est-zone-file">${escapeHtml(displayFileName(file))} <button type="button" data-est-additional-remove="${index}">Remove</button></span>
      `).join("")
      : "No additional documents uploaded.";
    els.estAdditionalStatus.querySelectorAll("[data-est-additional-remove]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        estimatedTaxesState.additionalFiles.splice(Number(button.dataset.estAdditionalRemove), 1);
        renderEstimatedTaxFiles();
        updateEstimatedCalculateAvailability();
      });
    });
  }
  els.estAdditionalDropzone?.classList.toggle("filled", estimatedTaxesState.additionalFiles.length > 0);
}

function renderEstimatedZoneStatus(zone, file, statusEl, dropzone, emptyText) {
  if (!statusEl) return;
  statusEl.innerHTML = file
    ? `<span class="est-zone-file">${escapeHtml(displayFileName(file))} <small>${formatBytes(file.size || 0)}</small> <button type="button" data-est-zone-clear="${zone}">Remove</button></span>`
    : emptyText;
  dropzone?.classList.toggle("filled", Boolean(file));
  statusEl.querySelector("[data-est-zone-clear]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const clearZone = event.currentTarget.dataset.estZoneClear;
    if (clearZone === "template") estimatedTaxesState.templateFile = null;
    if (clearZone === "pl") {
      estimatedTaxesState.plFile = null;
      estimatedTaxesState.plPeriod = null;
      if (els.estPlPeriodStatus) els.estPlPeriodStatus.hidden = true;
      if (els.estPlMonthsOverride) els.estPlMonthsOverride.value = "";
    }
    if (clearZone === "balanceSheet") estimatedTaxesState.balanceSheetFile = null;
    renderEstimatedTaxFiles();
    updateEstimatedEntityType(estimatedTaxesState.entityType);
    updateEstimatedCalculateAvailability();
  });
}

function hasEstimatedCarryforwardInput() {
  return ["estNol", "estCapitalLoss", "estCharitableCf", "estGbc", "estFtc", "estStateNol", "estOtherCf"].some((id) => estNumber(id) !== 0)
    || Boolean(estFieldValue("estOtherCfDescription"));
}

function updateEstimatedCalculateAvailability() {
  if (!els.estCalculateButton) return;
  els.estCalculateButton.disabled = !(estimatedTaxesState.entityType && estimatedTaxesState.quarter && estimatedTaxesState.plFile);
  updateEstimatedActionLabels();
}

function autoFillEstimatedCarryforwards() {
  try {
    const selected = window.selectedClient || window.currentClient || null;
    const carry = selected?.carryforwards || selected?.carryforward || {};
    const mappings = [
      ["estNol", carry.nol || carry.netOperatingLoss],
      ["estCapitalLoss", carry.capitalLoss || carry.capitalLossCarryover],
      ["estCharitableCf", carry.charitableContribution || carry.charitableContributionCarryforward],
      ["estGbc", carry.generalBusinessCredit],
      ["estFtc", carry.foreignTaxCredit],
      ["estStateNol", carry.stateNol || carry.stateNetOperatingLoss],
    ];
    let filled = 0;
    mappings.forEach(([id, value]) => {
      if (value !== undefined && value !== null && document.getElementById(id)) {
        document.getElementById(id).value = value;
        filled += 1;
      }
    });
    showToast(filled ? `Auto-filled ${filled} carryforward field(s).` : "No carryforwards found for the selected client.", filled ? "success" : "warning");
  } catch (_) {
    showToast("No client carryforwards found.", "warning");
  }
  updateEstimatedCalculateAvailability();
}

async function estimatedTaxFilesPayload() {
  const files = [
    estimatedTaxesState.templateFile ? { file: estimatedTaxesState.templateFile, role: "prior_year_template" } : null,
    estimatedTaxesState.plFile ? { file: estimatedTaxesState.plFile, role: "current_year_pl" } : null,
    estimatedTaxesState.balanceSheetFile ? { file: estimatedTaxesState.balanceSheetFile, role: "current_year_balance_sheet" } : null,
    ...estimatedTaxesState.taxReturnFiles.map((file) => ({ file, role: "prior_year_return" })),
  ].filter(Boolean);
  const output = [];
  for (const item of files) output.push(await prepareEstimatedZoneFilePayload(item.file, item.role));
  return output;
}

async function prepareEstimatedZoneFilePayload(file, role) {
  let prepared = {};
  try {
    prepared = file.content && !file.arrayBuffer ? { text: file.text || "", encoding: "base64" } : await prepareFileForReview({ file, type: "estimatedTaxes" });
  } catch (error) {
    console.warn("Estimated tax file preparation failed:", error);
  }
  return {
    name: displayFileName(file),
    size: file.size,
    type: file.type || guessMediaType(file.name),
    role,
    encoding: prepared.encoding || "base64",
    text: prepared.text || "",
    workbookTemplate: prepared.workbookTemplate || null,
    workbookTemplates: prepared.workbookTemplates || [],
    content: file.content || await readAsBase64(file),
  };
}

async function collectEstimatedTaxesPayload() {
  const taxYear = estNumber("estTaxYear") || new Date().getFullYear();
  const customTemplateFile = estimatedTaxesState.templateFile ? await prepareEstimatedZoneFilePayload(estimatedTaxesState.templateFile, "custom_template") : null;
  const plFile = estimatedTaxesState.plFile ? await prepareEstimatedZoneFilePayload(estimatedTaxesState.plFile, "current_year_pl") : null;
  const balanceSheetFile = estimatedTaxesState.balanceSheetFile ? await prepareEstimatedZoneFilePayload(estimatedTaxesState.balanceSheetFile, "current_year_balance_sheet") : null;
  const taxReturnFiles = [];
  for (const file of estimatedTaxesState.taxReturnFiles) taxReturnFiles.push(await prepareEstimatedZoneFilePayload(file, "prior_year_return"));
  const additionalFiles = [];
  for (const file of estimatedTaxesState.additionalFiles) additionalFiles.push(await prepareEstimatedZoneFilePayload(file, "supporting_document"));
  const plMonthsOverride = Number(estFieldValue("estPlMonthsOverride") || 0) || null;
  return {
    clientName: estFieldValue("estClientName") || "Client",
    clientEmail: estFieldValue("estClientEmail"),
    entityType: normalizeEstimatedEntityType(estimatedTaxesState.entityType),
    returnType: estimatedEntityLabel(estimatedTaxesState.entityType),
    taxYear,
    state: estFieldValue("estState"),
    period: estimatedTaxesState.quarter,
    quarter: estimatedTaxesState.quarter,
    quarterEndDate: `${taxYear}-${estimatedTaxesState.quarter === "Q1" ? "03-31" : estimatedTaxesState.quarter === "Q2" ? "06-30" : estimatedTaxesState.quarter === "Q3" ? "09-30" : "12-31"}`,
    federalPayments: {
      q1: estNumber("estQ1Federal"),
      q2: estNumber("estQ2Federal"),
      q3: estNumber("estQ3Federal"),
      extension: estNumber("estFederalExtensionPayment"),
      priorYearOverpayment: estNumber("estPriorOverFederal"),
    },
    statePayments: [
      {
        state: estFieldValue("estState"),
        q1: estNumber("estQ1State"),
        q2: estNumber("estQ2State"),
        q3: estNumber("estQ3State"),
        extension: estNumber("estStateExtensionPayment"),
        priorYearOverpayment: estNumber("estPriorOverState"),
        pte: estNumber("estStatePtePayment"),
      },
    ],
    customTemplateFile,
    templateFile: customTemplateFile,
    plFile,
    plMonthsOverride,
    balanceSheetFile,
    taxReturnFiles,
    additionalFiles,
    files: [customTemplateFile, plFile, balanceSheetFile, ...taxReturnFiles, ...additionalFiles].filter(Boolean),
    plDetection: estimatedTaxesState.plPeriod,
    notes: estFieldValue("estAdditionalNotes"),
  };
}

function collectExtensionPayload() {
  return {
    clientName: estFieldValue("estClientName") || "Client",
    clientEmail: estFieldValue("estClientEmail"),
    ein: estFieldValue("estEin"),
    returnType: estFieldValue("estReturnType") || "1040",
    taxYear: estNumber("estTaxYear") || new Date().getFullYear(),
    state: estFieldValue("estState"),
    filingStatus: estFieldValue("estFilingStatus"),
    dateOfDeath: estFieldValue("estDateOfDeath"),
    estimatedTaxLiability: {
      federalTaxEstimate: estNumber("extFederalTaxEstimate"),
      stateTaxEstimate: estNumber("extStateTaxEstimate"),
      priorYearFederalTax: estNumber("extPriorFederalTax"),
      priorYearStateTax: estNumber("extPriorStateTax"),
    },
    paymentsAlreadyMade: {
      federalWithholding: estNumber("extFederalWithholding"),
      federalEstimatedPayments: estNumber("extFederalEstimatedPayments"),
      priorYearOverpaymentApplied: estNumber("extPriorFederalOverpayment"),
      stateWithholding: estNumber("extStateWithholding"),
      stateEstimatedPayments: estNumber("extStateEstimatedPayments"),
      priorYearStateOverpaymentApplied: estNumber("extPriorStateOverpayment"),
    },
    notes: estFieldValue("extAdditionalNotes"),
  };
}

async function calculateEstimatedTaxesOrExtension() {
  const endpoint = "/api/estimated-taxes/calculate";
  const payload = await collectEstimatedTaxesPayload();
  if (!payload.clientName || !payload.taxYear) {
    showToast("Complete client name and tax year before generating.", "warning");
    return;
  }
  if (!payload.entityType || !payload.period || !payload.plFile) {
    showToast("Select entity type, period, and upload the current-year P&L before generating.", "warning");
    return;
  }
  const activeButton = els.estCalculateButton;
  if (activeButton) {
    activeButton.disabled = true;
    activeButton.textContent = "Generating workpaper...";
  }
  if (els.estStatus) els.estStatus.textContent = "Generating...";
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Calculation failed.");
    estimatedTaxesState.lastResult = { ...data, mode: "estimate" };
    renderEstimatedTaxResult(data);
    if (els.estStatus) els.estStatus.textContent = "Calculation ready.";
    if (els.estSidebarTotal) els.estSidebarTotal.textContent = estMoney(data.totalDue ?? data.totalPayment ?? 0);
  } catch (error) {
    showToast(error.message, "error");
    if (els.estStatus) els.estStatus.textContent = "Calculation failed.";
    if (els.estResults) {
      els.estResults.innerHTML = `<article class="generator-result-card error"><span class="tag danger">Workpaper not generated</span><p>${escapeHtml(error.message)}</p><p class="muted-note">No blank zero workbook was generated. Confirm the current-year P&L is uploaded and readable, then rerun.</p></article>`;
    }
    if (els.estDownloadWorkbook) els.estDownloadWorkbook.disabled = true;
    if (els.estCopySummary) els.estCopySummary.disabled = true;
  } finally {
    if (activeButton) activeButton.disabled = false;
    updateEstimatedActionLabels();
    updateEstimatedCalculateAvailability();
  }
}

function renderEstimatedTaxResult(result) {
  if (!els.estResults) return;
  els.estResults.hidden = false;
  const federalDue = result.federalDue ?? result.summary?.federalDue ?? result.federalReconciliation?.paymentDue ?? 0;
  const stateDue = result.stateDue ?? result.summary?.stateDue ?? (result.stateReconciliations || []).reduce((sum, row) => sum + Number(row.paymentDue || row.balanceDue || 0), 0);
  const totalDue = result.totalDue ?? result.summary?.totalDue ?? (Number(federalDue || 0) + Number(stateDue || 0));
  const flags = Array.isArray(result.flags) ? result.flags : Array.isArray(result.caveats) ? result.caveats.map((item) => ({ severity: item.severity, message: item.text })) : [];
  els.estResults.innerHTML = `
    <div class="tax-payment-banner ${resultRiskClass(totalDue)}">
      <div>
        <div class="tax-payment-label">${escapeHtml(result.period || result.quarter || "")} estimated payment${result.dueDate ? ` due ${escapeHtml(result.dueDate)}` : ""}</div>
        <div class="tax-payment-total">${estMoney(totalDue)}</div>
      </div>
      <div class="tax-payment-split">
        <span>Federal: <strong>${estMoney(federalDue)}</strong></span>
        <span>${escapeHtml(result.state || result.stateReconciliations?.[0]?.state || "State")}: <strong>${estMoney(stateDue)}</strong></span>
      </div>
    </div>
    <div class="est-result-grid">
      <div class="est-kpi"><span>P&L period</span><strong>${escapeHtml(result.plPeriodLabel || `${result.plPeriodMonths || ""} months`)}</strong></div>
      <div class="est-kpi"><span>Annualized net income</span><strong>${estMoney(result.annualizedNetIncome ?? result.bookNetIncomeAnnual)}</strong></div>
      <div class="est-kpi"><span>Taxable income</span><strong>${estMoney(result.taxableIncomeBeforeSpecial ?? result.taxableIncome)}</strong></div>
    </div>
    ${result.aiWorkbookStatus ? `<div class="est-ai-status">${escapeHtml(result.aiWorkbookStatus)}</div>` : ""}
    ${renderEstimatedFlags(flags)}
    ${renderEstimatedFileLog(result.fileReadingConfirmation)}
    ${renderEstimatedAnnualizedPl(result.annualizedPL)}
    <h4>Book-to-tax adjustments</h4>
    ${renderAdjustmentsTable(result.bookToTaxAdjustments || result.adjustments)}
    ${renderSources(result.sources)}
  `;
  if (els.estDownloadWorkbook) els.estDownloadWorkbook.disabled = !result.workbook && !result.contentBase64;
  if (els.estCopySummary) els.estCopySummary.disabled = !result.paymentSummary && !result.email?.body;
  renderEstimatedEmail(result);
}

function renderEstimatedFlags(flags = []) {
  if (!flags.length) return "";
  return `<div class="est-flags">${flags.map((flag) => `<div class="est-flag severity-${escapeHtml(String(flag.severity || "note").toLowerCase())}"><strong>${escapeHtml(flag.severity || "Note")}</strong> ${escapeHtml(flag.message || flag.text || "")}</div>`).join("")}</div>`;
}

function renderEstimatedFileLog(log = []) {
  if (!Array.isArray(log) || !log.length) return "";
  return `
    <h4>File reading confirmation</h4>
    <table class="b2t-table">
      <thead><tr><th>File</th><th>Purpose</th><th>Status</th><th>Notes</th></tr></thead>
      <tbody>${log.map((row) => `<tr><td>${escapeHtml(row.fileName || row.name || "")}</td><td>${escapeHtml(row.purpose || "")}</td><td>${escapeHtml(row.status || "")}</td><td>${escapeHtml(row.notes || "")}</td></tr>`).join("")}</tbody>
    </table>`;
}

function renderEstimatedAnnualizedPl(rows = []) {
  if (!Array.isArray(rows) || !rows.length) return "";
  return `
    <h4>Annualized P&L</h4>
    <table class="b2t-table">
      <thead><tr><th>Line</th><th>Source amount</th><th>Factor</th><th>Annualized</th><th>Source</th></tr></thead>
      <tbody>${rows.slice(0, 12).map((row) => `<tr><td>${escapeHtml(row.line || row.name || "")}</td><td>${estMoney(row.sourceAmount ?? row.amount)}</td><td>${escapeHtml(row.annualizationFactor ?? row.factor ?? "")}</td><td>${estMoney(row.annualizedAmount ?? row.annualized)}</td><td>${escapeHtml(row.source || "")}</td></tr>`).join("")}</tbody>
    </table>`;
}

function renderExtensionResult(result) {
  if (!els.estResults) return;
  els.estResults.hidden = false;
  els.estResults.innerHTML = `
    <div class="tax-payment-banner ${resultRiskClass(result.totalPayment)}">
      <div>
        <div class="tax-payment-label">Extension payment recommended</div>
        <div class="tax-payment-total">${estMoney(result.totalPayment)}</div>
      </div>
      <div class="tax-payment-split">
        <span>Federal: <strong>${estMoney(result.federalPayment)}</strong></span>
        <span>${escapeHtml(result.state || "State")}: <strong>${estMoney(result.statePayment)}</strong></span>
      </div>
    </div>
    <div class="extension-warning">${escapeHtml(result.warning || "")}</div>
    <div class="est-result-grid">
      <div class="est-kpi"><span>Original due date</span><strong>${escapeHtml(result.federal?.originalDue || "")}</strong></div>
      <div class="est-kpi"><span>Extended due date</span><strong>${escapeHtml(result.federal?.extendedDue || "")}</strong></div>
      <div class="est-kpi"><span>Extension form</span><strong>${escapeHtml(result.federal?.form || "")}</strong></div>
    </div>
    <h4>Penalty scenarios</h4>
    ${renderExtensionPenaltyTable(result.penaltyAnalysis)}
    <h4>Filing instructions</h4>
    <div class="est-instructions">${escapeHtml(result.filingInstructions || "").replace(/\n/g, "<br>")}</div>
  `;
  if (els.estDownloadWorkbook) els.estDownloadWorkbook.disabled = !result.workbook;
  if (els.estCopySummary) els.estCopySummary.disabled = !result.paymentSummary && !result.email?.body;
  renderEstimatedEmail(result);
}

function renderEstimatedEmail(result) {
  if (!els.estEmailCard) return;
  els.estEmailCard.hidden = false;
  els.estEmailSubject.value = result.emailSubject || result.email?.subject || "";
  els.estEmailBody.value = result.emailBody || result.email?.body || "";
  estimatedTaxesState.reviewedWorkpaper = null;
  if (els.estReviewedWorkbookStatus) els.estReviewedWorkbookStatus.textContent = "No reviewed workbook uploaded yet.";
}

function resultRiskClass(amount) {
  const value = Number(amount || 0);
  if (value >= 50000) return "risk-high";
  if (value >= 10000) return "risk-medium";
  return "risk-low";
}

function renderAdjustmentsTable(adjustments = []) {
  if (!adjustments.length) return `<p class="muted">No book-to-tax adjustments returned.</p>`;
  return `
    <table class="b2t-table">
      <thead><tr><th>Adjustment</th><th>Book</th><th>Tax</th><th>Difference</th><th>Source / authority</th></tr></thead>
      <tbody>
        ${adjustments.map((row) => `
          <tr>
            <td>${escapeHtml(row.name || row.adjustment || row.description || "")}</td>
            <td>${estMoney(row.bookAmount ?? row.book)}</td>
            <td>${estMoney(row.taxAmount ?? row.tax)}</td>
            <td>${estMoney(row.adjustmentAmount ?? row.adjustment ?? row.difference)}</td>
            <td>${row.url ? `<a href="${escapeHtml(row.url)}" target="_blank" rel="noopener">${escapeHtml(row.authority || row.source || "Source")}</a>` : escapeHtml(row.authority || row.source || row.notes || "")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderExtensionPenaltyTable(rows = []) {
  if (!rows.length) return `<p class="muted">No penalty scenarios returned.</p>`;
  return `
    <table class="b2t-table">
      <thead><tr><th>Scenario</th><th>Rate</th><th>Monthly cost</th><th>Annualized cost</th></tr></thead>
      <tbody>
        ${rows.map((row) => `<tr><td>${escapeHtml(row.scenario)}</td><td>${escapeHtml(row.rate)}</td><td>${estMoney(row.monthlyCost)}</td><td>${estMoney(row.annualCost)}</td></tr>`).join("")}
      </tbody>
    </table>
  `;
}

function renderCaveats(caveats = []) {
  if (!caveats.length) return "";
  return `
    <div class="est-caveats">
      ${caveats.map((item) => `<div class="est-caveat severity-${escapeHtml(String(item.severity || "low").toLowerCase())}"><strong>${escapeHtml(item.severity || "Note")}</strong> ${escapeHtml(item.text || "")}</div>`).join("")}
    </div>
  `;
}

function renderSources(sources = []) {
  if (!sources.length) return "";
  return `
    <div class="est-sources">
      <h4>Sources</h4>
      ${sources.map((source) => `<a href="${escapeHtml(source.url || "#")}" target="_blank" rel="noopener">${escapeHtml(source.title || "Source")}</a><span>${escapeHtml(source.relevance || "")}</span>`).join("")}
    </div>
  `;
}

function estMoney(value) {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function buildEstimatedWorkbookFileName(result) {
  const base = `estimated_tax_${result.clientName || "client"}_${result.taxYear || ""}_${result.period || result.quarter || ""}`;
  return `${base.replace(/[^a-z0-9_-]+/gi, "_").replace(/_+/g, "_")}.xlsx`;
}

function downloadEstimatedTaxesWorkbook() {
  const result = estimatedTaxesState.lastResult;
  if (!result?.workbook && !result?.contentBase64) {
    showToast("Run the calculation before downloading the workbook.", "warning");
    return;
  }
  if (result.contentBase64) {
    downloadBase64File(
      result.filename || buildEstimatedWorkbookFileName(result),
      result.contentBase64,
      result.mimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    return;
  }
  downloadWorkbook(buildEstimatedWorkbookFileName(result), result.workbook);
}

async function copyEstimatedTaxesSummary() {
  const result = estimatedTaxesState.lastResult;
  if (!result) return showToast("Run the calculation before copying the summary.", "warning");
  const text = result.paymentSummary || result.email?.body || "";
  await navigator.clipboard.writeText(text);
  showToast("Summary copied.", "success");
}

function workbookToXlsxBase64(workbook) {
  const XLSX = window.XLSX;
  if (!XLSX) throw new Error("Excel engine is not loaded.");
  const wb = XLSX.utils.book_new();
  const sheets = workbook && Array.isArray(workbook.sheets) ? workbook.sheets : [];
  sheets.forEach((sheet, index) => {
    const rows = Array.isArray(sheet.rows) && sheet.rows.length ? sheet.rows : [["No rows returned"]];
    const normalizedRows = rows.map((row) => (Array.isArray(row) ? row : [row]).map(sanitizeExcelCell));
    const ws = XLSX.utils.aoa_to_sheet(normalizedRows);
    if (Array.isArray(sheet.merges) && sheet.merges.length) ws["!merges"] = sheet.merges;
    ws["!cols"] = Array.isArray(sheet.cols) && sheet.cols.length ? sheet.cols : inferWorksheetColumns(normalizedRows);
    applyWorksheetStyles(ws, sheet, normalizedRows);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(safeText(sheet.name) || `Sheet ${index + 1}`));
  });
  return XLSX.write(wb, { bookType: "xlsx", type: "base64" });
}

async function sendEstimatedTaxesEmail() {
  const result = estimatedTaxesState.lastResult;
  if (!result) return showToast("Run the calculation before creating the Gmail draft.", "warning");
  const to = estFieldValue("estClientEmail") || result.clientEmail;
  if (!to) return showToast("Add a client email before creating the Gmail draft.", "warning");
  const gmailTab = window.open("about:blank", "_blank", "noopener");
  els.estSendEmail.disabled = true;
  els.estSendEmail.textContent = "Creating Gmail draft...";
  try {
    const reviewedFile = estimatedTaxesState.reviewedWorkpaper;
    if (!reviewedFile) {
      showToast("Upload the reviewed Excel workpaper before creating the client email.", "warning");
      return;
    }
    const attachmentName = displayFileName(reviewedFile);
    const attachmentBase64 = await readAsBase64(reviewedFile);
    const response = await fetch(`${API_BASE_URL}/api/deliverable/create-gmail-draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to,
        subject: els.estEmailSubject.value.trim() || result.email?.subject || "Tax payment workpaper",
        bodyText: els.estEmailBody.value || result.email?.body || "",
        bodyHtml: plainTextEmailToHtml(els.estEmailBody.value || result.email?.body || ""),
        attachments: [{
          name: attachmentName,
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          contentBase64: attachmentBase64,
        }],
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Gmail could not create the draft.");
    const url = data.gmailUrl || "https://mail.google.com/mail/u/0/#drafts";
    if (gmailTab) gmailTab.location.href = url;
    else window.open(url, "_blank", "noopener");
    showToast("Gmail draft created with the workpaper attached.", "success");
  } catch (error) {
    if (gmailTab) gmailTab.close();
    showToast(error.message, "error");
    if (String(error.message || "").toLowerCase().includes("permission")) connectGoogleDrive();
  } finally {
    els.estSendEmail.disabled = false;
    els.estSendEmail.textContent = "Create Gmail Draft with Reviewed Workpaper";
  }
}

function setupTrackerEvents() {
  document.querySelectorAll("[data-tracker-view]").forEach((button) => button.addEventListener("click", () => setTrackerView(button.dataset.trackerView)));
  document.querySelectorAll("[data-calendar-view]").forEach((button) => button.addEventListener("click", () => setCalendarView(button.dataset.calendarView)));
  els.trackerSettingsButton?.addEventListener("click", openTrackerSettings);
  els.trackerSettingsClose?.addEventListener("click", () => { els.trackerSettingsModal.hidden = true; });
  document.querySelectorAll("[data-settings-tab]").forEach((button) => button.addEventListener("click", () => setTrackerSettingsTab(button.dataset.settingsTab)));
  els.trackerAddTaskButton?.addEventListener("click", () => openTaskModal());
  els.trackerTaskCancel?.addEventListener("click", () => { els.trackerTaskModal.hidden = true; });
  els.trackerTaskSave?.addEventListener("click", saveTrackerTask);
  els.ptoPrevMonth?.addEventListener("click", () => changePtoMonth(-1));
  els.ptoNextMonth?.addEventListener("click", () => changePtoMonth(1));
  els.ptoRequestButton?.addEventListener("click", openPtoRequestModal);
  els.ptoCancelRequest?.addEventListener("click", () => { els.ptoRequestModal.hidden = true; });
  ["ptoStartDate", "ptoEndDate", "ptoHalfDay"].forEach((id) => document.getElementById(id)?.addEventListener("change", updatePtoDaysCounter));
  els.ptoSubmitRequest?.addEventListener("click", submitPtoRequest);
  els.ptoSaveSettings?.addEventListener("click", savePtoSettings);
}

async function loadTrackerData() {
  try {
    const data = await fetch(`${API_BASE_URL}/api/tracker`).then((res) => res.json());
    trackerState.sections = data.sections || [];
    trackerState.statuses = data.statuses || [];
    trackerState.sectionStatuses = data.sectionStatuses || {};
    trackerState.tasks = data.tasks || [];
    trackerState.ptoEntries = data.pto?.entries || [];
    trackerState.ptoSettings = data.pto?.settings || {};
    renderTracker();
  } catch (error) {
    showToast(`Could not load tracker: ${error.message}`, "error");
  }
}

function setTrackerView(view) {
  trackerState.activeView = view || "board";
  document.querySelectorAll("[data-tracker-view]").forEach((button) => button.classList.toggle("active", button.dataset.trackerView === trackerState.activeView));
  if (els.trackerBoardView) els.trackerBoardView.hidden = trackerState.activeView !== "board";
  if (els.trackerListView) els.trackerListView.hidden = trackerState.activeView !== "list";
  if (els.trackerCalendarView) els.trackerCalendarView.hidden = trackerState.activeView !== "calendar";
  renderTracker();
}

function setCalendarView(view) {
  trackerState.calendarView = view || "my";
  document.querySelectorAll("[data-calendar-view]").forEach((button) => button.classList.toggle("active", button.dataset.calendarView === trackerState.calendarView));
  if (els.calendarMyView) els.calendarMyView.hidden = trackerState.calendarView !== "my";
  if (els.calendarPtoView) els.calendarPtoView.hidden = trackerState.calendarView !== "pto";
  if (els.calendarTeamView) els.calendarTeamView.hidden = trackerState.calendarView !== "team";
  renderTrackerCalendar();
}

function changeTrackerCalendarMonth(delta) {
  const current = trackerState.calendarMonth || new Date();
  trackerState.calendarMonth = new Date(current.getFullYear(), current.getMonth() + delta, 1);
  renderTrackerCalendar();
}

function resetTrackerCalendarMonth() {
  const today = new Date();
  trackerState.calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  renderTrackerCalendar();
}

function renderTracker() {
  if (els.trackerSidebarTasks) els.trackerSidebarTasks.textContent = String(trackerState.tasks.length);
  if (els.trackerSidebarPto) els.trackerSidebarPto.textContent = String(trackerState.ptoEntries.filter((entry) => entry.status !== "rejected").length);
  renderTrackerBoard();
  renderTrackerList();
  renderTrackerCalendar();
  renderTrackerSettings();
}

function statusesForTrackerSection(sectionId) {
  return [...(trackerState.sectionStatuses?.[sectionId] || trackerState.statuses || [])].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

function renderTrackerBoard() {
  if (!els.trackerBoard) return;
  const sections = trackerState.sections || [];
  els.trackerBoard.innerHTML = `
    <div class="tracker-board-v2">
      ${sections.map(buildTrackerSectionBlock).join("")}
      <div class="add-section-row">
        <button class="add-section-btn" type="button" data-add-section>+ Add Section</button>
      </div>
    </div>
  `;
  bindTrackerBoardEvents();
}

function buildTrackerSectionBlock(section) {
  const tasks = trackerState.tasks.filter((task) => task.sectionId === section.id);
  const statuses = statusesForTrackerSection(section.id);
  const collapsed = trackerState.collapsedSections.has(section.id);
  return `
    <article class="section-block" data-section-id="${escapeHtml(section.id)}" data-collapsed="${collapsed ? "true" : "false"}">
      <header class="section-header" data-toggle-section="${escapeHtml(section.id)}">
        <button class="section-collapse-btn" type="button" data-toggle-section="${escapeHtml(section.id)}" aria-label="Toggle section">
          <span class="section-collapse-icon">v</span>
        </button>
        <span class="section-icon" style="background:${escapeHtml(section.color || "#2563eb")}">${escapeHtml(section.icon || "")}</span>
        <button class="section-name" type="button" data-rename-section="${escapeHtml(section.id)}">${escapeHtml(section.name)}</button>
        <span class="section-task-count">${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}</span>
        <div class="section-header-actions">
          <button class="section-add-task-btn" type="button" data-new-task-section="${escapeHtml(section.id)}">+ Add Task</button>
          <button class="section-settings-btn" type="button" data-section-settings title="Section settings">Settings</button>
          <button class="section-delete-btn" type="button" data-delete-section="${escapeHtml(section.id)}" title="Delete section">x</button>
        </div>
      </header>
      <div class="section-swimlanes">
        <div class="swimlanes-scroll">
          ${statuses.map((status) => buildTrackerSwimlane(section, status, tasks)).join("")}
        </div>
      </div>
    </article>
  `;
}

function buildTrackerSwimlane(section, status, sectionTasks) {
  const statusTasks = sectionTasks.filter((task) => task.status === status.id);
  return `
    <section class="swimlane" data-section-id="${escapeHtml(section.id)}" data-status-id="${escapeHtml(status.id)}" style="--status-color:${escapeHtml(status.color || "#64748b")};--status-bg:${escapeHtml(status.bg || "#f8fafc")}">
      <div class="swimlane-header">
        <span class="swimlane-dot"></span>
        <span class="swimlane-name">${escapeHtml(status.label)}</span>
        <span class="swimlane-count">${statusTasks.length}</span>
      </div>
      <div class="swimlane-body" data-drop-section="${escapeHtml(section.id)}" data-drop-status="${escapeHtml(status.id)}">
        ${statusTasks.map(renderTrackerTaskCard).join("") || `<div class="swimlane-empty">No tasks</div>`}
      </div>
      <button class="swimlane-add-btn" type="button" data-new-task-section="${escapeHtml(section.id)}" data-new-task-status="${escapeHtml(status.id)}">+ Add</button>
    </section>
  `;
}

function renderTrackerTaskCard(task) {
  return `
    <article class="tracker-task-card" draggable="true" data-task-card="${escapeHtml(task.id)}">
      <button class="tracker-task-title" type="button" data-edit-task="${escapeHtml(task.id)}">${escapeHtml(task.title)}</button>
      <div class="tracker-task-meta">${escapeHtml(task.clientName || "No client")}${task.dueDate ? ` &middot; Due ${escapeHtml(task.dueDate)}` : ""}</div>
      <div class="tracker-task-footer">
        <span>${escapeHtml(task.assignee || "Unassigned")}</span>
        <span>${formatTrackerMinutes(task.totalMinutes)}</span>
      </div>
      <div class="tracker-task-actions">
        <button class="card-log-time-btn" type="button" data-log-time="${escapeHtml(task.id)}">Log time</button>
        <button type="button" data-delete-task="${escapeHtml(task.id)}">Delete</button>
      </div>
    </article>
  `;
}

function renderTrackerList() {
  if (!els.trackerList) return;
  els.trackerList.innerHTML = `
    <table class="tracker-table">
      <thead><tr><th>Task</th><th>Client</th><th>Section</th><th>Status</th><th>Assignee</th><th>Due</th><th></th></tr></thead>
      <tbody>
        ${trackerState.tasks.map((task) => {
          const section = trackerState.sections.find((item) => item.id === task.sectionId);
          const status = statusesForTrackerSection(task.sectionId).find((item) => item.id === task.status);
          return `<tr><td>${escapeHtml(task.title)}</td><td>${escapeHtml(task.clientName || "")}</td><td>${escapeHtml(section?.name || "")}</td><td><span class="status-pill" style="background:${escapeHtml(status?.bg || "#f1f5f9")};color:${escapeHtml(status?.color || "#64748b")}">${escapeHtml(status?.label || task.status)}</span></td><td>${escapeHtml(task.assignee || "")}</td><td>${escapeHtml(task.dueDate || "")}</td><td><button class="ghost-button small-button" data-edit-task="${escapeHtml(task.id)}" type="button">Edit</button></td></tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
  bindTrackerTaskButtons();
}

function bindTrackerTaskButtons() {
  document.querySelectorAll("[data-edit-task]").forEach((button) => button.addEventListener("click", () => openTaskModal(button.dataset.editTask)));
  document.querySelectorAll("[data-delete-task]").forEach((button) => button.addEventListener("click", () => deleteTrackerTask(button.dataset.deleteTask)));
}

function bindTrackerBoardEvents() {
  bindTrackerTaskButtons();
  document.querySelector("[data-add-section]")?.addEventListener("click", promptAddTrackerSection);
  document.querySelectorAll("[data-toggle-section]").forEach((item) => item.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleTrackerSection(item.dataset.toggleSection);
  }));
  document.querySelectorAll("[data-rename-section]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    promptRenameTrackerSection(button.dataset.renameSection);
  }));
  document.querySelectorAll("[data-section-settings]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    openTrackerSettings();
  }));
  document.querySelectorAll("[data-delete-section]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    deleteTrackerSection(button.dataset.deleteSection);
  }));
  document.querySelectorAll("[data-new-task-section]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    openTaskModal("", { sectionId: button.dataset.newTaskSection, status: button.dataset.newTaskStatus || "" });
  }));
  document.querySelectorAll("[data-log-time]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    showQuickLogPopover(button, button.dataset.logTime);
  }));
  document.querySelectorAll("[data-task-card]").forEach((card) => {
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", card.dataset.taskCard);
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
  });
  document.querySelectorAll("[data-drop-section]").forEach((lane) => {
    lane.addEventListener("dragover", (event) => {
      event.preventDefault();
      lane.classList.add("drag-over");
    });
    lane.addEventListener("dragleave", () => lane.classList.remove("drag-over"));
    lane.addEventListener("drop", async (event) => {
      event.preventDefault();
      lane.classList.remove("drag-over");
      const taskId = event.dataTransfer.getData("text/plain");
      await moveTrackerTask(taskId, lane.dataset.dropSection, lane.dataset.dropStatus);
    });
  });
}

function toggleTrackerSection(sectionId) {
  if (!sectionId) return;
  if (trackerState.collapsedSections.has(sectionId)) trackerState.collapsedSections.delete(sectionId);
  else trackerState.collapsedSections.add(sectionId);
  renderTrackerBoard();
}

async function moveTrackerTask(taskId, sectionId, status) {
  const task = trackerState.tasks.find((item) => item.id === taskId);
  if (!task || (task.sectionId === sectionId && task.status === status)) return;
  await fetch(`${API_BASE_URL}/api/tracker/tasks/${encodeURIComponent(taskId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sectionId, status }),
  });
  await loadTrackerData();
}

function formatTrackerMinutes(minutes) {
  const total = Number(minutes || 0);
  if (!total) return "0m";
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return hours ? `${hours}h${mins ? ` ${mins}m` : ""}` : `${mins}m`;
}

async function logTrackerTime(taskId, minutes, note = "") {
  const response = await fetch(`${API_BASE_URL}/api/tracker/tasks/${encodeURIComponent(taskId)}/time`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ minutes, note }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return showToast(data.error || "Could not log time.", "error");
  closeQuickLogPopover();
  await loadTrackerData();
}

function showQuickLogPopover(anchor, taskId) {
  closeQuickLogPopover();
  const popover = document.createElement("div");
  popover.id = "trackerQuickLogPopover";
  popover.className = "quick-log-popover";
  popover.innerHTML = `
    <strong>Log time</strong>
    <div class="quick-log-options">
      <button type="button" data-minutes="15">15m</button>
      <button type="button" data-minutes="30">30m</button>
      <button type="button" data-minutes="60">1h</button>
    </div>
    <div class="quick-log-custom">
      <input type="number" min="1" max="1440" placeholder="Minutes" />
      <button type="button" data-custom-log>Save</button>
    </div>
  `;
  document.body.appendChild(popover);
  const rect = anchor.getBoundingClientRect();
  popover.style.left = `${Math.min(rect.left, window.innerWidth - 220)}px`;
  popover.style.top = `${rect.bottom + 6}px`;
  popover.querySelectorAll("[data-minutes]").forEach((button) => button.addEventListener("click", () => logTrackerTime(taskId, Number(button.dataset.minutes))));
  popover.querySelector("[data-custom-log]")?.addEventListener("click", () => {
    const value = Number(popover.querySelector("input")?.value || 0);
    if (!value) return showToast("Enter minutes to log.", "warning");
    logTrackerTime(taskId, value);
  });
  window.setTimeout(() => document.addEventListener("click", closeQuickLogPopover, { once: true }), 0);
}

function closeQuickLogPopover(event) {
  if (event?.target?.closest?.("#trackerQuickLogPopover")) {
    document.addEventListener("click", closeQuickLogPopover, { once: true });
    return;
  }
  document.getElementById("trackerQuickLogPopover")?.remove();
}

function renderTrackerCalendar() {
  renderSimpleCalendar(els.calendarMyView, false);
  renderPtoCalendar();
  renderSimpleCalendar(els.calendarTeamView, true);
}

function renderSimpleCalendar(container, includeTeam) {
  if (!container) return;
  const visibleMonth = trackerState.calendarMonth || new Date();
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const monthLabel = visibleMonth.toLocaleString("en-US", { month: "long", year: "numeric" });
  const cells = monthDateCells(year, month);
  const visiblePto = trackerState.ptoEntries.filter((entry) => entry.status !== "rejected" && (includeTeam || entry.userId === currentUser.username));
  container.innerHTML = `
    <div class="tracker-calendar-title">
      <button class="calendar-month-btn" type="button" data-calendar-month-nav="-1">Prev</button>
      <div class="tracker-calendar-heading">
        <span class="tracker-calendar-name">${includeTeam ? "Team Calendar" : "My Calendar"}</span>
        <span class="tracker-calendar-month">${escapeHtml(monthLabel)}</span>
      </div>
      <div class="calendar-month-actions">
        <button class="calendar-month-btn" type="button" data-calendar-month-today>Today</button>
        <button class="calendar-month-btn" type="button" data-calendar-month-nav="1">Next</button>
      </div>
    </div>
    <div class="tracker-month-grid">
      ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<div class="calendar-day-head">${day}</div>`).join("")}
      ${cells.map((date) => {
        const dateStr = isoDate(date);
        const dueTasks = trackerState.tasks.filter((task) => task.dueDate === dateStr);
        const pto = visiblePto.filter((entry) => dateStr >= entry.startDate && dateStr <= entry.endDate);
        return `<div class="tracker-day-cell ${date.getMonth() === month ? "" : "muted"}" data-date="${dateStr}"><strong>${date.getDate()}</strong>${dueTasks.map((task) => `<div class="task-dot">${escapeHtml(task.title)}</div>`).join("")}${pto.map((entry) => `<div class="pto-bar ${entry.status}" style="background:${escapeHtml(entry.userColor)}">${escapeHtml(entry.userInitials)} ${escapeHtml(ptoTypeLabel(entry.type))}</div>`).join("")}</div>`;
      }).join("")}
    </div>
  `;
  container.querySelectorAll("[data-calendar-month-nav]").forEach((button) => {
    button.addEventListener("click", () => changeTrackerCalendarMonth(Number(button.dataset.calendarMonthNav) || 0));
  });
  container.querySelector("[data-calendar-month-today]")?.addEventListener("click", resetTrackerCalendarMonth);
}

function renderPtoCalendar() {
  if (!els.ptoCalendarGrid) return;
  const year = trackerState.ptoMonth.getFullYear();
  const month = trackerState.ptoMonth.getMonth();
  if (els.ptoMonthLabel) els.ptoMonthLabel.textContent = trackerState.ptoMonth.toLocaleString("en-US", { month: "long", year: "numeric" });
  const cells = monthDateCells(year, month);
  els.ptoCalendarGrid.innerHTML = `
    ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<div class="calendar-day-head">${day}</div>`).join("")}
    ${cells.map((date) => {
      const dateStr = isoDate(date);
      const entries = trackerState.ptoEntries.filter((entry) => entry.status !== "rejected" && dateStr >= entry.startDate && dateStr <= entry.endDate);
      return `<div class="tracker-day-cell ${date.getMonth() === month ? "" : "muted"}" data-date="${dateStr}"><strong>${date.getDate()}</strong>${entries.map((entry) => `<div class="pto-bar ${entry.status}" title="${escapeHtml(entry.userName)} - ${escapeHtml(ptoTypeLabel(entry.type))}" style="background:${escapeHtml(entry.userColor)}">${escapeHtml(entry.userInitials)} ${escapeHtml(ptoTypeLabel(entry.type))}</div>`).join("")}</div>`;
    }).join("")}
  `;
  renderPtoPanel();
}

function renderPtoPanel() {
  const mine = trackerState.ptoEntries.filter((entry) => entry.userId === currentUser.username);
  const approved = mine.filter((entry) => entry.status === "approved").reduce((sum, entry) => sum + Number(entry.totalDays || 0), 0);
  const pending = mine.filter((entry) => entry.status === "pending").reduce((sum, entry) => sum + Number(entry.totalDays || 0), 0);
  const allotted = trackerState.ptoSettings.ptoDaysAllotted?.[currentUser.username] ?? null;
  els.ptoStatsRow.innerHTML = `<div class="pto-stat-card"><div class="pto-stat-value">${approved}</div><div class="pto-stat-label">Used</div></div><div class="pto-stat-card pending"><div class="pto-stat-value">${pending}</div><div class="pto-stat-label">Pending</div></div>${allotted === null ? "" : `<div class="pto-stat-card remaining"><div class="pto-stat-value">${allotted - approved}</div><div class="pto-stat-label">Remaining</div></div>`}`;
  els.ptoMyList.innerHTML = mine.map(renderPtoEntryRow).join("") || `<div class="tracker-empty">No PTO requests yet.</div>`;
  els.ptoTeamList.innerHTML = trackerState.ptoEntries.filter((entry) => entry.status !== "rejected").map(renderPtoEntryRow).join("") || `<div class="tracker-empty">No upcoming team PTO.</div>`;
  if (els.ptoAdminPanel) els.ptoAdminPanel.hidden = currentUser.role !== "admin";
  if (els.ptoRequireApproval) els.ptoRequireApproval.checked = Boolean(trackerState.ptoSettings.requireApproval);
  if (els.ptoMaxDays) els.ptoMaxDays.value = trackerState.ptoSettings.maxDaysPerYear ?? "";
  if (els.ptoPendingApprovals) {
    els.ptoPendingApprovals.innerHTML = trackerState.ptoEntries.filter((entry) => entry.status === "pending").map((entry) => `<div class="pto-approval-row"><strong>${escapeHtml(entry.userName)}</strong><span>${escapeHtml(ptoTypeLabel(entry.type))}: ${escapeHtml(entry.startDate)} - ${escapeHtml(entry.endDate)} (${entry.totalDays} days)</span><button class="pto-approve-btn" data-approve-pto="${escapeHtml(entry.id)}">Approve</button><button class="pto-reject-btn" data-reject-pto="${escapeHtml(entry.id)}">Reject</button></div>`).join("") || `<div class="tracker-empty">No pending requests.</div>`;
    document.querySelectorAll("[data-approve-pto]").forEach((button) => button.addEventListener("click", () => reviewPto(button.dataset.approvePto, "approve")));
    document.querySelectorAll("[data-reject-pto]").forEach((button) => button.addEventListener("click", () => reviewPto(button.dataset.rejectPto, "reject")));
  }
  document.querySelectorAll("[data-delete-pto]").forEach((button) => button.addEventListener("click", () => deletePto(button.dataset.deletePto)));
}

function renderPtoEntryRow(entry) {
  return `<div class="pto-entry-row"><div class="pto-entry-icon">${escapeHtml(ptoTypeEmoji(entry.type))}</div><div class="pto-entry-info"><div class="pto-entry-title">${escapeHtml(ptoTypeLabel(entry.type))} Â· ${escapeHtml(entry.startDate)} â†’ ${escapeHtml(entry.endDate)} (${entry.totalDays} days)</div><div class="pto-entry-dates">${escapeHtml(entry.userName)} <span class="pto-badge pto-badge-${escapeHtml(entry.status)}">${escapeHtml(entry.status)}</span></div>${entry.note ? `<div class="pto-entry-note">${escapeHtml(entry.note)}</div>` : ""}</div><div class="pto-entry-actions"><button class="pto-action-btn" data-delete-pto="${escapeHtml(entry.id)}" type="button">Delete</button></div></div>`;
}

function monthDateCells(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function ptoTypeLabel(type) {
  return ({ vacation: "Vacation", sick: "Sick", personal: "Personal", holiday: "Holiday", other: "Other" })[type] || "PTO";
}

function ptoTypeEmoji(type) {
  return ({ vacation: "ðŸ–", sick: "ðŸ¤’", personal: "ðŸ‘¤", holiday: "ðŸŽ‰", other: "ðŸ“‹" })[type] || "ðŸ“‹";
}

function openTaskModal(taskId = "", defaults = {}) {
  const task = trackerState.tasks.find((item) => item.id === taskId) || {};
  els.trackerTaskId.value = task.id || "";
  els.trackerTaskTitle.value = task.title || "";
  els.trackerTaskClient.value = task.clientName || "";
  els.trackerTaskAssignee.value = task.assignee || currentUser.displayName || "";
  els.trackerTaskDue.value = task.dueDate || "";
  els.trackerTaskNotes.value = task.notes || "";
  els.trackerTaskSection.innerHTML = trackerState.sections.map((section) => `<option value="${escapeHtml(section.id)}">${escapeHtml(section.name)}</option>`).join("");
  els.trackerTaskSection.value = task.sectionId || defaults.sectionId || trackerState.sections[0]?.id || "";
  updateTaskStatusOptions(task.status || defaults.status || "");
  els.trackerTaskSection.onchange = () => updateTaskStatusOptions();
  els.trackerTaskModal.hidden = false;
}

function updateTaskStatusOptions(selected = "") {
  const statuses = statusesForTrackerSection(els.trackerTaskSection.value);
  els.trackerTaskStatus.innerHTML = statuses.map((status) => `<option value="${escapeHtml(status.id)}">${escapeHtml(status.label)}</option>`).join("");
  els.trackerTaskStatus.value = selected || statuses[0]?.id || "";
}

async function saveTrackerTask() {
  const id = els.trackerTaskId.value;
  const payload = { title: els.trackerTaskTitle.value, clientName: els.trackerTaskClient.value, sectionId: els.trackerTaskSection.value, status: els.trackerTaskStatus.value, assignee: els.trackerTaskAssignee.value, dueDate: els.trackerTaskDue.value, notes: els.trackerTaskNotes.value };
  const response = await fetch(`${API_BASE_URL}/api/tracker/tasks${id ? `/${encodeURIComponent(id)}` : ""}`, { method: id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return showToast(data.error || "Could not save task.", "error");
  els.trackerTaskModal.hidden = true;
  await loadTrackerData();
}

async function deleteTrackerTask(id) {
  if (!confirm("Delete this task?")) return;
  await fetch(`${API_BASE_URL}/api/tracker/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
  await loadTrackerData();
}

function openTrackerSettings() {
  renderTrackerSettings();
  els.trackerSettingsModal.hidden = false;
}

function setTrackerSettingsTab(tab) {
  document.querySelectorAll("[data-settings-tab]").forEach((button) => button.classList.toggle("active", button.dataset.settingsTab === tab));
  els.trackerSettingsSections.hidden = tab !== "sections";
  els.trackerSettingsStatuses.hidden = tab !== "statuses";
}

function trackerEmojiFromCode(code) {
  const value = parseInt(String(code || ""), 16);
  return Number.isFinite(value) ? String.fromCodePoint(value) : "";
}

function trackerDefaultSectionEmoji() {
  return trackerEmojiFromCode("1f4c1");
}

function trackerEmojiPaletteHtml(kind, targetId, selectedEmoji) {
  const selected = selectedEmoji || trackerDefaultSectionEmoji();
  return `
    <div class="emoji-picker-popover" data-${kind}-emoji-popover="${escapeHtml(targetId)}" hidden>
      ${TRACKER_SECTION_EMOJIS.map((item) => {
        const emoji = trackerEmojiFromCode(item.code);
        return `<button class="emoji-picker-option ${emoji === selected ? "selected" : ""}" type="button" data-${kind}-emoji-pick="${escapeHtml(targetId)}" data-emoji-code="${escapeHtml(item.code)}" title="${escapeHtml(item.label)}">${escapeHtml(emoji)}</button>`;
      }).join("")}
    </div>
  `;
}

function renderTrackerSectionEmojiControl(section) {
  const icon = section.icon || trackerDefaultSectionEmoji();
  return `
    <div class="settings-emoji-control">
      <button class="settings-emoji-button" type="button" data-section-emoji-toggle="${escapeHtml(section.id)}" aria-label="Choose emoji for ${escapeHtml(section.name)}">${escapeHtml(icon)}</button>
      ${trackerEmojiPaletteHtml("section", section.id, icon)}
    </div>
    <input class="settings-emoji-input" data-section-icon="${escapeHtml(section.id)}" value="${escapeHtml(icon)}" maxlength="4" title="Custom emoji" />
  `;
}

function renderNewSectionEmojiControl() {
  const icon = trackerDefaultSectionEmoji();
  return `
    <div class="settings-emoji-control">
      <button id="newSectionEmojiButton" class="settings-emoji-button" type="button" data-new-section-emoji-toggle="new" aria-label="Choose emoji for new section">${escapeHtml(icon)}</button>
      ${trackerEmojiPaletteHtml("new-section", "new", icon)}
    </div>
    <input id="newSectionIcon" class="settings-emoji-input" value="${escapeHtml(icon)}" maxlength="4" title="Custom emoji" />
  `;
}

function renderTrackerSectionSettingsRow(section) {
  return `
    <div class="settings-drag-row">
      <span class="color-swatch" style="background:${escapeHtml(section.color)}"></span>
      ${renderTrackerSectionEmojiControl(section)}
      <input class="settings-name-input" data-section-name="${escapeHtml(section.id)}" value="${escapeHtml(section.name)}" />
      <button class="settings-delete-btn" data-delete-section="${escapeHtml(section.id)}">x</button>
    </div>
  `;
}

function renderTrackerSettings() {
  if (!els.trackerSettingsSections || !els.trackerSettingsStatuses) return;
  els.trackerSettingsSections.innerHTML = `<div class="settings-section-label">Manage Sections</div><p class="settings-section-subtitle">Sections organize your tasks by category. Choose the emoji shown next to each section name.</p>${trackerState.sections.map(renderTrackerSectionSettingsRow).join("")}<div class="settings-add-row">${renderNewSectionEmojiControl()}<input id="newSectionName" class="settings-add-input" placeholder="New section name" /><button id="addSectionBtn" class="settings-add-btn">Create</button></div>`;
  els.trackerSettingsStatuses.innerHTML = `<div class="settings-section-label">Global Statuses</div><p class="settings-section-subtitle">These apply to all sections unless customized.</p>${trackerState.statuses.map((status) => `<div class="settings-drag-row"><span class="status-dot-preview" style="background:${escapeHtml(status.color)}"></span><input class="settings-name-input" data-status-name="${escapeHtml(status.id)}" value="${escapeHtml(status.label)}" /><input class="settings-color-input" data-status-color="${escapeHtml(status.id)}" value="${escapeHtml(status.color)}" /><input class="settings-color-input" data-status-bg="${escapeHtml(status.id)}" value="${escapeHtml(status.bg)}" /><label class="is-final-toggle"><input type="checkbox" data-status-final="${escapeHtml(status.id)}" ${status.isFinal ? "checked" : ""}/> Done</label>${status.isDefault ? `<span class="settings-lock-icon">lock</span>` : `<button class="settings-delete-btn" data-delete-status="${escapeHtml(status.id)}">x</button>`}</div>`).join("")}<div class="settings-add-row"><input id="newStatusName" class="settings-add-input" placeholder="New status name" /><button id="addStatusBtn" class="settings-add-btn">Create</button></div>`;
  bindTrackerSettingsEvents();
}

function bindTrackerSettingsEvents() {
  document.querySelectorAll("[data-section-name]").forEach((input) => input.addEventListener("change", () => updateTrackerSection(input.dataset.sectionName, { name: input.value })));
  document.querySelectorAll("[data-section-icon]").forEach((input) => input.addEventListener("change", () => updateTrackerSection(input.dataset.sectionIcon, { icon: input.value })));
  document.querySelectorAll("[data-section-emoji-toggle]").forEach((button) => button.addEventListener("click", () => toggleTrackerEmojiPicker("section", button.dataset.sectionEmojiToggle)));
  document.querySelectorAll("[data-section-emoji-pick]").forEach((button) => button.addEventListener("click", () => updateTrackerSection(button.dataset.sectionEmojiPick, { icon: trackerEmojiFromCode(button.dataset.emojiCode) })));
  document.querySelectorAll("[data-new-section-emoji-toggle]").forEach((button) => button.addEventListener("click", () => toggleTrackerEmojiPicker("new-section", button.dataset.newSectionEmojiToggle)));
  document.querySelectorAll("[data-new-section-emoji-pick]").forEach((button) => button.addEventListener("click", () => selectNewTrackerSectionEmoji(trackerEmojiFromCode(button.dataset.emojiCode))));
  document.querySelectorAll("[data-status-name]").forEach((input) => input.addEventListener("change", () => updateTrackerStatus(input.dataset.statusName, { label: input.value })));
  document.querySelectorAll("[data-status-color]").forEach((input) => input.addEventListener("change", () => updateTrackerStatus(input.dataset.statusColor, { color: input.value })));
  document.querySelectorAll("[data-status-bg]").forEach((input) => input.addEventListener("change", () => updateTrackerStatus(input.dataset.statusBg, { bg: input.value })));
  document.querySelectorAll("[data-status-final]").forEach((input) => input.addEventListener("change", () => updateTrackerStatus(input.dataset.statusFinal, { isFinal: input.checked })));
  document.querySelectorAll("[data-delete-section]").forEach((button) => button.addEventListener("click", () => deleteTrackerSection(button.dataset.deleteSection)));
  document.querySelectorAll("[data-delete-status]").forEach((button) => button.addEventListener("click", () => deleteTrackerStatus(button.dataset.deleteStatus)));
  document.getElementById("addSectionBtn")?.addEventListener("click", addTrackerSection);
  document.getElementById("addStatusBtn")?.addEventListener("click", addTrackerStatus);
}

function toggleTrackerEmojiPicker(kind, targetId) {
  const attr = kind === "section" ? "sectionEmojiPopover" : "newSectionEmojiPopover";
  const popover = document.querySelector(`[data-${kind}-emoji-popover="${CSS.escape(targetId)}"]`);
  const shouldOpen = Boolean(popover?.hidden);
  document.querySelectorAll(".emoji-picker-popover").forEach((item) => { item.hidden = true; });
  if (popover) popover.hidden = !shouldOpen;
}

function selectNewTrackerSectionEmoji(icon) {
  const input = document.getElementById("newSectionIcon");
  const button = document.getElementById("newSectionEmojiButton");
  if (input) input.value = icon || trackerDefaultSectionEmoji();
  if (button) button.textContent = icon || trackerDefaultSectionEmoji();
  document.querySelectorAll(".emoji-picker-popover").forEach((item) => { item.hidden = true; });
}

async function updateTrackerSection(id, payload) {
  await fetch(`${API_BASE_URL}/api/tracker/sections/${encodeURIComponent(id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  await loadTrackerData();
}

async function updateTrackerStatus(id, payload) {
  await fetch(`${API_BASE_URL}/api/tracker/statuses/${encodeURIComponent(id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  await loadTrackerData();
}

async function addTrackerSection() {
  const input = document.getElementById("newSectionName");
  const iconInput = document.getElementById("newSectionIcon");
  const name = input?.value.trim();
  if (!name) return;
  await fetch(`${API_BASE_URL}/api/tracker/sections`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, icon: iconInput?.value || trackerDefaultSectionEmoji() }) });
  await loadTrackerData();
}

async function promptAddTrackerSection() {
  const name = prompt("New section name");
  if (!name?.trim()) return;
  await fetch(`${API_BASE_URL}/api/tracker/sections`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
  await loadTrackerData();
}

async function promptRenameTrackerSection(sectionId) {
  const section = trackerState.sections.find((item) => item.id === sectionId);
  if (!section) return;
  const name = prompt("Rename section", section.name);
  if (!name?.trim() || name.trim() === section.name) return;
  await updateTrackerSection(sectionId, { name: name.trim() });
}

async function addTrackerStatus() {
  const input = document.getElementById("newStatusName");
  const label = input?.value.trim();
  if (!label) return;
  await fetch(`${API_BASE_URL}/api/tracker/statuses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label }) });
  await loadTrackerData();
}

async function deleteTrackerSection(id) {
  if (!confirm("Delete this section? Tasks will need to be moved or deleted if present.")) return;
  let response = await fetch(`${API_BASE_URL}/api/tracker/sections/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (response.status === 400) {
    const target = trackerState.sections.find((section) => section.id !== id)?.id;
    response = await fetch(`${API_BASE_URL}/api/tracker/sections/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "move", targetSectionId: target }) });
  }
  await loadTrackerData();
}

async function deleteTrackerStatus(id) {
  if (!confirm("Delete this status?")) return;
  const response = await fetch(`${API_BASE_URL}/api/tracker/statuses/${encodeURIComponent(id)}`, { method: "DELETE" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return showToast(data.message || data.error || "Could not delete status.", "error");
  await loadTrackerData();
}

function changePtoMonth(delta) {
  trackerState.ptoMonth = new Date(trackerState.ptoMonth.getFullYear(), trackerState.ptoMonth.getMonth() + delta, 1);
  renderPtoCalendar();
}

function openPtoRequestModal() {
  const today = isoDate(new Date());
  els.ptoStartDate.value = today;
  els.ptoEndDate.value = today;
  els.ptoNote.value = "";
  updatePtoDaysCounter();
  els.ptoRequestModal.hidden = false;
}

function updatePtoDaysCounter() {
  const days = els.ptoHalfDay.checked ? 0.5 : calculateWorkingDaysClient(els.ptoStartDate.value, els.ptoEndDate.value || els.ptoStartDate.value);
  els.ptoDaysCounter.textContent = `${days} working day${days === 1 ? "" : "s"}`;
}

function calculateWorkingDaysClient(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    if (![0, 6].includes(cur.getDay())) count += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

async function submitPtoRequest() {
  const payload = { type: els.ptoType.value, startDate: els.ptoStartDate.value, endDate: els.ptoEndDate.value || els.ptoStartDate.value, halfDay: els.ptoHalfDay.checked, halfDayPeriod: els.ptoHalfDayPeriod.value, note: els.ptoNote.value };
  const response = await fetch(`${API_BASE_URL}/api/pto`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return showToast(data.message || data.error || "Could not submit PTO.", "error");
  els.ptoRequestModal.hidden = true;
  await loadTrackerData();
}

async function deletePto(id) {
  if (!confirm("Delete this PTO entry?")) return;
  await fetch(`${API_BASE_URL}/api/pto/${encodeURIComponent(id)}`, { method: "DELETE" });
  await loadTrackerData();
}

async function reviewPto(id, action) {
  await fetch(`${API_BASE_URL}/api/pto/${encodeURIComponent(id)}/${action}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "" }) });
  await loadTrackerData();
}

async function savePtoSettings() {
  const payload = { requireApproval: els.ptoRequireApproval.checked, maxDaysPerYear: els.ptoMaxDays.value ? Number(els.ptoMaxDays.value) : null, ptoDaysAllotted: trackerState.ptoSettings.ptoDaysAllotted || {} };
  await fetch(`${API_BASE_URL}/api/pto/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  await loadTrackerData();
}

async function initSoftwareSelector() {
  try {
    availableSoftware = await fetch(`${API_BASE_URL}/api/tax-software/list`).then((res) => res.json());
  } catch (_) {
    availableSoftware = [
      { id: "proconnect", name: "ProConnect Tax", vendor: "Intuit", type: "cloud", logo: "PT", description: "Cloud-based. Left sidebar navigation.", screenTerminology: { screen: "Input screen", navigate: "Go to [Screen] > [Section] > [Field]" } },
      { id: "other", name: "Other / Not Listed", vendor: "Other", type: "generic", logo: "OT", description: "Generic IRS form and line references.", screenTerminology: { screen: "Section", navigate: "Navigate to [Form] > [Line]" } },
    ];
  }
  renderSoftwareDropdown("prep");
  renderSoftwareDropdown("firm");
  const defaults = readFirmDefaults();
  const libraryDefault = databaseState.library?.defaultTaxSoftware || "";
  setFirmSoftwareSelection(defaults.defaultTaxSoftware || libraryDefault || "proconnect");
  refreshPrepSoftwareFromClient();
}

function setupSoftwareSelectorEvents() {
  els.prepSoftwareButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    els.prepSoftwareDropdown?.classList.toggle("open");
  });
  els.firmSoftwareButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    els.firmSoftwareDropdown?.classList.toggle("open");
  });
  els.prepSoftwareBadgeChange?.addEventListener("click", () => {
    setWorkspaceMode("preparation");
    els.prepSoftwareDropdown?.classList.add("open");
    els.prepSoftwareSelector?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  els.databaseSaveDefaultSoftware?.addEventListener("click", saveFirmDefaultSoftware);
  document.addEventListener("click", (event) => {
    if (els.prepSoftwareSelector && !els.prepSoftwareSelector.contains(event.target)) els.prepSoftwareDropdown?.classList.remove("open");
    const firmSelector = document.getElementById("firmSoftwareSelector");
    if (firmSelector && !firmSelector.contains(event.target)) els.firmSoftwareDropdown?.classList.remove("open");
  });
}

function softwareById(softwareId) {
  return availableSoftware.find((software) => software.id === softwareId) || availableSoftware.find((software) => software.id === "other") || availableSoftware[0];
}

function diagnosticsSoftwareIdFromLabel(label = "") {
  const normalized = String(label).toLowerCase();
  if (normalized.includes("proconnect")) return "proconnect";
  if (normalized.includes("lacerte")) return "lacerte";
  if (normalized.includes("proseries")) return "proseries";
  if (normalized.includes("drake")) return "drake";
  if (normalized.includes("ultratax")) return "ultratax";
  if (normalized.includes("axcess")) return "cch_axcess";
  if (normalized.includes("prosystem")) return "cch_prosystem";
  if (normalized.includes("gosystem")) return "gosystem";
  if (normalized.includes("taxslayer")) return "taxslayer_pro";
  if (normalized.includes("atx")) return "atx";
  return "other";
}

function syncDiagnosticsSoftware(software) {
  if (!els.diagnosticsSoftware || !software) return;
  const match = Array.from(els.diagnosticsSoftware.options).find((option) => diagnosticsSoftwareIdFromLabel(option.value || option.textContent) === software.id);
  if (match) {
    els.diagnosticsSoftware.value = match.value;
    updateDiagnosticsReadyState();
  }
}

function groupedSoftwareOptions() {
  const groups = new Map();
  availableSoftware.forEach((software) => {
    const vendor = software.vendor || "Other";
    if (!groups.has(vendor)) groups.set(vendor, []);
    groups.get(vendor).push(software);
  });
  return [...groups.entries()];
}

function renderSoftwareDropdown(target) {
  const dropdown = target === "firm" ? els.firmSoftwareDropdown : els.prepSoftwareDropdown;
  if (!dropdown) return;
  dropdown.innerHTML = groupedSoftwareOptions().map(([vendor, items]) => `
    <div class="software-group-label">${escapeHtml(vendor)}</div>
    ${items.map((software) => `
      <button class="software-option" type="button" data-software-target="${target}" data-software-id="${escapeHtml(software.id)}">
        <span class="software-option-logo">${escapeHtml(software.logo || "")}</span>
        <span class="software-option-info">
          <span class="software-option-name">${escapeHtml(software.name)}</span>
          <span class="software-option-vendor">${escapeHtml(software.vendor || "")}</span>
        </span>
        <span class="software-type-chip software-type-${escapeHtml(software.type || "generic")}">${escapeHtml(software.type || "")}</span>
      </button>`).join("")}
  `).join("");
  dropdown.querySelectorAll("[data-software-id]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.softwareTarget === "firm") setFirmSoftwareSelection(button.dataset.softwareId);
    else setPrepSoftwareSelection(button.dataset.softwareId, { saveClient: true, syncDiagnostics: true });
    dropdown.classList.remove("open");
  }));
}

function renderSoftwareInfo(target, software) {
  const info = target === "firm" ? els.firmSoftwareInfo : els.prepSoftwareInfo;
  if (!info || !software) return;
  info.innerHTML = `
    <span class="software-info-icon">Info</span>
    <span class="software-info-text">
      <strong>${escapeHtml(software.name)} navigation style</strong><br>
      ${escapeHtml(software.description || "")}
      <span class="software-info-nav">Instructions will use ${escapeHtml(software.screenTerminology?.screen || "screen")} terminology and the format: ${escapeHtml(software.screenTerminology?.navigate || "standard form references")}.</span>
    </span>`;
}

function updateSoftwareButton(prefix, software) {
  const ids = prefix === "firm"
    ? ["firm-software-selected-logo", "firm-software-selected-name", "firm-software-selected-vendor"]
    : ["software-selected-logo", "software-selected-name", "software-selected-vendor"];
  document.getElementById(ids[0]).textContent = software?.logo || "";
  document.getElementById(ids[1]).textContent = software?.name || "";
  document.getElementById(ids[2]).textContent = software?.vendor || "";
}

function setFirmSoftwareSelection(softwareId) {
  const software = softwareById(softwareId || "proconnect");
  if (!software) return;
  const defaults = readFirmDefaults();
  defaults.defaultTaxSoftware = software.id;
  writeFirmDefaults(defaults);
  updateSoftwareButton("firm", software);
  renderSoftwareInfo("firm", software);
  if (els.databaseDefaultSoftwareStatus) els.databaseDefaultSoftwareStatus.textContent = `Selected: ${software.name}`;
}

async function saveFirmDefaultSoftware() {
  const software = softwareById(readFirmDefaults().defaultTaxSoftware || prepState.taxSoftware || "proconnect");
  await fetch(`${API_BASE_URL}/api/library/default-tax-software`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ defaultTaxSoftware: software.id }),
  }).catch(() => null);
  if (els.databaseDefaultSoftwareStatus) els.databaseDefaultSoftwareStatus.textContent = `Saved: ${software.name}`;
  await loadDatabaseLibrary().catch(() => null);
}

function activePreparationClient() {
  if (databaseState.selectedClientId) return databaseState.clients.find((client) => client.id === databaseState.selectedClientId) || null;
  const names = [
    document.getElementById("clientName")?.value,
    document.getElementById("entityName")?.value,
    document.getElementById("prepEntityName")?.value,
    els.deliverableClientName?.value,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  return databaseState.clients.find((client) => names.includes(String(client.name || "").trim().toLowerCase())) || null;
}

function refreshPrepSoftwareFromClient() {
  if (!availableSoftware.length) return;
  const client = activePreparationClient();
  const defaults = readFirmDefaults();
  const clientSoftware = client?.taxSoftware?.primary || "";
  const firmDefault = defaults.defaultTaxSoftware || databaseState.library?.defaultTaxSoftware || "";
  const selected = clientSoftware || firmDefault || "proconnect";
  const source = clientSoftware
    ? `Loaded from client record: ${softwareById(selected)?.name || selected}`
    : firmDefault
      ? `Using firm default: ${softwareById(selected)?.name || selected}${client ? ` <button id="setPrepSoftwareForClient" class="text-button" type="button">Set for this client</button>` : ""}`
      : "Using built-in default: ProConnect Tax";
  setPrepSoftwareSelection(selected, { saveClient: false, syncDiagnostics: true, sourceMessage: source });
  document.getElementById("setPrepSoftwareForClient")?.addEventListener("click", () => savePrepSoftwareForClient());
}

function setPrepSoftwareSelection(softwareId, options = {}) {
  const software = softwareById(softwareId || "proconnect");
  if (!software) return;
  prepState.taxSoftware = software.id;
  prepState.taxSoftwareLabel = software.name;
  updateSoftwareButton("prep", software);
  renderSoftwareInfo("prep", software);
  renderPrepSoftwareBadge(software);
  if (els.prepSoftwareSource) els.prepSoftwareSource.innerHTML = options.sourceMessage || `Instructions for ${escapeHtml(software.name)}.`;
  if (options.syncDiagnostics) syncDiagnosticsSoftware(software);
  if (options.saveClient) savePrepSoftwareForClient();
  invalidateEntryGuideCache();
}

function renderPrepSoftwareBadge(software) {
  if (!els.prepSoftwareBadge) return;
  els.prepSoftwareBadge.hidden = false;
  els.prepSoftwareBadge.innerHTML = `Instructions for: <strong>${escapeHtml(software.logo || "")} ${escapeHtml(software.name)}</strong> <button id="prepSoftwareBadgeChange" class="change-link" type="button">Change</button>`;
  document.getElementById("prepSoftwareBadgeChange")?.addEventListener("click", () => {
    els.prepSoftwareDropdown?.classList.add("open");
    els.prepSoftwareSelector?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

async function savePrepSoftwareForClient() {
  const client = activePreparationClient();
  if (!client) {
    if (els.prepSoftwareSource) els.prepSoftwareSource.textContent = "Selection saved for this session. Select or create a client to save it permanently.";
    return;
  }
  const software = softwareById(prepState.taxSoftware);
  await fetch(`${API_BASE_URL}/api/clients/${client.id}/tax-software`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ primary: software.id, version: document.getElementById("prepCurrentYear")?.value || document.getElementById("taxYear")?.value || "", customNotes: "" }),
  }).catch(() => null);
  if (els.prepSoftwareSource) els.prepSoftwareSource.textContent = `Saved for ${client.name}.`;
  await loadDatabaseClients().catch(() => null);
}

function setupDiagnosticsShortcut() {
  document.addEventListener("keydown", (event) => {
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const modifier = isMac ? event.metaKey : event.ctrlKey;
    if (modifier && event.shiftKey && event.key.toLowerCase() === "d") {
      event.preventDefault();
      setWorkspaceMode("diagnostics");
      els.diagnosticsErrorText.focus();
      els.diagnosticsRunHint.textContent = "Paste your errors here (Ctrl+V).";
    }
  });
}

function setupResearchEvents() {
  renderResearchEmptyState();
  updateResearchCounts();
  els.researchInput?.addEventListener("input", () => {
    els.researchInput.style.height = "auto";
    els.researchInput.style.height = `${Math.min(els.researchInput.scrollHeight, 140)}px`;
    updateResearchSendButton();
  });
  els.researchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendResearchMessage();
    }
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const modifier = isMac ? event.metaKey : event.ctrlKey;
    if (modifier && event.key.toLowerCase() === "f" && !els.researchPanel?.hidden) {
      event.preventDefault();
      els.researchInput.focus();
    }
  });
  els.researchSendButton?.addEventListener("click", sendResearchMessage);
  els.researchClearButton?.addEventListener("click", clearResearchConversation);
  els.researchClearConversation?.addEventListener("click", clearResearchConversation);
  els.researchThinkingToggle?.addEventListener("change", () => { researchState.useThinking = els.researchThinkingToggle.checked; });
  els.researchWebSearchToggle?.addEventListener("change", () => { researchState.webSearch = els.researchWebSearchToggle.checked; });
  els.researchAddContext?.addEventListener("click", () => {
    hydrateResearchContextFromCurrentSession();
    showToast("Current return context added to Tax Research.", "success");
  });
  document.querySelectorAll("[data-research-topic]").forEach((button) => {
    button.addEventListener("click", () => useResearchTopic(button.dataset.researchTopic));
  });
  updateResearchSendButton();
}

function hydrateResearchContextFromCurrentSession() {
  const metadata = lastReview?.payload?.metadata || {};
  const returnType = metadata.returnType || document.getElementById("returnType")?.value || "";
  const taxYear = metadata.taxYear || document.getElementById("taxYear")?.value || new Date().getFullYear();
  const state = metadata.statesIncluded || "";
  if (els.researchReturnType && returnType) els.researchReturnType.value = returnType;
  if (els.researchTaxYear && taxYear) els.researchTaxYear.value = taxYear;
  if (els.researchState && state) {
    const firstState = String(state).split(",")[0].trim();
    const option = [...els.researchState.options].find((item) => item.textContent.toLowerCase() === firstState.toLowerCase() || item.value.toLowerCase() === firstState.toLowerCase());
    if (option) els.researchState.value = option.value;
  }
}

function updateResearchSendButton() {
  const text = els.researchInput?.value || "";
  if (els.researchCharCount) els.researchCharCount.textContent = `${text.length} characters`;
  if (els.researchSendButton) els.researchSendButton.disabled = !text.trim() || researchState.isLoading;
}

function renderResearchEmptyState() {
  if (!els.researchMessages || researchState.messages.length) return;
  els.researchMessages.innerHTML = `
    <div class="research-empty-state">
      <div class="research-empty-icon">Search</div>
      <div class="research-empty-title">Ask anything about US tax law</div>
      <div class="research-empty-subtitle">Get answers with cited IRS, IRC, Treasury Regulation, and state authority links.</div>
      <div class="research-example-cards">
        <button class="research-example-card" type="button" data-question="What is the Section 199A QBI deduction limit for 2025 and how is it calculated for an S-Corp?">What is the Section 199A QBI deduction limit for 2025 and how is it calculated for an S-Corp?</button>
        <button class="research-example-card" type="button" data-question="When is Schedule M-3 required and what happens if a corporation files Schedule M-1 instead?">When is Schedule M-3 required and what happens if a corporation files Schedule M-1 instead?</button>
        <button class="research-example-card" type="button" data-question="What are the California FTB filing requirements for an LLC taxed as a partnership?">What are the California FTB filing requirements for an LLC taxed as a partnership?</button>
      </div>
    </div>`;
  els.researchMessages.querySelectorAll("[data-question]").forEach((button) => button.addEventListener("click", () => useResearchQuestion(button.dataset.question)));
}

function useResearchQuestion(text) {
  if (!els.researchInput) return;
  els.researchInput.value = text;
  els.researchInput.dispatchEvent(new Event("input"));
  els.researchInput.focus();
}

function useResearchTopic(topic) {
  const year = els.researchTaxYear?.value || new Date().getFullYear();
  const returnType = els.researchReturnType?.value || "the relevant return";
  const starters = {
    "Deduction Limits": `What deduction limits should I verify for ${returnType} for tax year ${year}?`,
    "Depreciation": `What are the current Section 179 and bonus depreciation limits for tax year ${year}?`,
    "Entity Structure": "What are the federal tax implications of changing entity structure between C corporation, S corporation, and partnership status?",
    "Schedule K-1": `What Schedule K-1 reporting requirements should I verify for ${returnType} for tax year ${year}?`,
    "Foreign Income": `What foreign income reporting requirements apply for tax year ${year}?`,
    "Self-Employment": `What self-employment tax rules and deductions apply for tax year ${year}?`,
    "Real Estate": "What are the passive activity loss rules for real estate rental income?",
    "Capital Gains": `What are the long-term capital gains rates for tax year ${year}, and how are they calculated?`,
    "Estate & Gift": `What is the estate and gift tax exclusion amount for tax year ${year}?`,
    "Credits": `What business tax credits should be considered for tax year ${year}?`,
    "Filing Deadlines": `What are the federal filing deadlines for ${returnType} for tax year ${year}?`,
    "Recent Changes": `What recent federal tax law changes affect ${returnType} for tax year ${year}?`,
  };
  useResearchQuestion(starters[topic] || `Research ${topic} for tax purposes.`);
}

async function sendResearchMessage() {
  const question = els.researchInput?.value.trim();
  if (!question || researchState.isLoading) return;
  els.researchInput.value = "";
  els.researchInput.style.height = "auto";
  updateResearchSendButton();
  appendResearchUserMessage(question);
  const loadingId = appendResearchLoading();
  researchState.isLoading = true;
  updateResearchSendButton();
  window.setTimeout(() => updateResearchLoadingText(loadingId, "Searching IRS and state authority sources..."), 3000);
  window.setTimeout(() => updateResearchLoadingText(loadingId, "Formulating cited answer..."), 8000);
  try {
    const payload = {
      messages: researchState.history,
      question,
      context: {
        returnType: els.researchReturnType?.value || null,
        taxYear: els.researchTaxYear?.value || null,
        state: els.researchState?.value || null,
        clientType: els.researchClientType?.value || null,
      },
      useThinking: researchState.useThinking,
      webSearch: researchState.webSearch,
    };
    const data = await fetch(`${API_BASE_URL}/api/research/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Tax research failed.");
      return body;
    });
    removeResearchLoading(loadingId);
    appendResearchAiMessage(data);
    researchState.history.push({ role: "user", content: question }, { role: "assistant", content: data.answer || "" });
    researchState.history = researchState.history.slice(-20);
    renderResearchHistory();
  } catch (error) {
    removeResearchLoading(loadingId);
    appendResearchError(error.message || "Tax research failed.");
  } finally {
    researchState.isLoading = false;
    updateResearchSendButton();
    updateResearchCounts();
    scrollResearchToBottom();
  }
}

function appendResearchUserMessage(question) {
  clearResearchEmptyState();
  const id = `research-user-${Date.now()}`;
  researchState.messages.push({ id, role: "user", content: question, timestamp: new Date().toISOString() });
  els.researchMessages.insertAdjacentHTML("beforeend", `
    <div id="${id}" class="research-user-message">
      <div class="research-user-bubble">${escapeHtml(question)}</div>
      <div class="research-user-avatar">${escapeHtml((currentUser.displayName || currentUsername || "U").slice(0, 1).toUpperCase())}</div>
    </div>`);
  scrollResearchToBottom();
}

function appendResearchAiMessage(data) {
  clearResearchEmptyState();
  const id = `research-ai-${Date.now()}`;
  researchState.totalSources += Array.isArray(data.sources) ? data.sources.length : 0;
  researchState.messages.push({ id, role: "assistant", content: data.answer || "", timestamp: new Date().toISOString(), sources: data.sources || [] });
  els.researchMessages.insertAdjacentHTML("beforeend", `
    <div id="${id}" class="research-ai-message">
      <div class="research-ai-avatar">R</div>
      <div class="research-ai-bubble">${renderResearchAnswer(data)}</div>
    </div>`);
  bindResearchMessageActions();
  updateResearchCounts();
}

function appendResearchError(message) {
  clearResearchEmptyState();
  els.researchMessages.insertAdjacentHTML("beforeend", `
    <div class="research-ai-message">
      <div class="research-ai-avatar">!</div>
      <div class="research-ai-bubble"><div class="research-answer-text"><strong>Research failed</strong><p>${escapeHtml(message)}</p></div></div>
    </div>`);
}

function appendResearchLoading() {
  clearResearchEmptyState();
  const id = `research-loading-${Date.now()}`;
  els.researchMessages.insertAdjacentHTML("beforeend", `
    <div id="${id}" class="research-ai-message">
      <div class="research-ai-avatar">R</div>
      <div class="research-loading">
        <span class="research-loading-dot"></span><span class="research-loading-dot"></span><span class="research-loading-dot"></span>
        <span data-loading-text>Researching...</span>
      </div>
    </div>`);
  scrollResearchToBottom();
  return id;
}

function updateResearchLoadingText(id, text) {
  const node = document.getElementById(id);
  const label = node?.querySelector("[data-loading-text]");
  if (label) label.textContent = text;
}

function removeResearchLoading(id) {
  document.getElementById(id)?.remove();
}

function clearResearchEmptyState() {
  els.researchMessages?.querySelector(".research-empty-state")?.remove();
}

function renderResearchAnswer(data) {
  const thinking = data.thinking || "";
  const thinkingHtml = thinking.trim() ? `
    <div class="research-thinking-section">
      <button class="thinking-toggle" type="button">View AI reasoning process</button>
      <div class="thinking-content" hidden>
        <div class="thinking-label">Extended thinking - Claude's internal reasoning</div>
        <div class="thinking-text">${escapeHtml(thinking)}</div>
      </div>
    </div>` : "";
  const sourcesHtml = renderResearchSources(data.sources || []);
  return `
    ${thinkingHtml}
    <div class="research-answer-text">${formatResearchAnswer(data.answer || "")}</div>
    ${sourcesHtml}
    <div class="research-answer-footer">
      <span>Model: ${escapeHtml(data.model || "claude")}</span>
      <span class="research-disclaimer">Always verify with primary sources.</span>
    </div>`;
}

function formatResearchAnswer(text) {
  let html = escapeHtml(text || "");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/^(Answer:|Key Rules & Requirements:|Sources & Citations:|Important Caveats:|Related Questions to Consider:)$/gm, '<div class="research-section-label">$1</div>');
  html = html.replace(/(IRC\s*Â§\s*[\w().-]+|Treas\.\s*Reg\.\s*Â§\s*[\w().-]+|Rev\.\s*(?:Rul|Proc)\.\s*[\d-]+)/g, '<span class="citation-chip">$1</span>');
  html = html.replace(/(?:^|\n)[â€¢*-]\s+(.+)/g, "\n<li>$1</li>");
  html = html.replace(/((?:<li>[\s\S]*?<\/li>\n?)+)/g, '<ul class="research-list">$1</ul>');
  return html.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean).map((part) => part.startsWith("<") ? part : `<p>${part.replace(/\n/g, "<br>")}</p>`).join("");
}

function renderResearchSources(sources) {
  if (!sources.length) return "";
  return `
    <div class="research-sources-section">
      <div class="sources-title">Sources & Citations</div>
      ${sources.map((source) => `
        <div class="source-card">
          <div class="source-header"><span class="source-index">[${source.index}]</span><span class="source-title">${escapeHtml(source.title)}</span></div>
          ${source.section ? `<div class="source-section">${escapeHtml(source.section)}</div>` : ""}
          <div class="source-relevance">${escapeHtml(source.relevance || "")}</div>
          <a class="source-link" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">Open Source</a>
        </div>`).join("")}
    </div>`;
}

function bindResearchMessageActions() {
  els.researchMessages?.querySelectorAll(".thinking-toggle").forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => {
      const content = button.nextElementSibling;
      const open = !content.hidden;
      content.hidden = open;
      button.textContent = open ? "View AI reasoning process" : "Hide AI reasoning process";
    });
  });
}

function renderResearchHistory() {
  if (!els.researchHistoryList) return;
  const userMessages = researchState.messages.filter((message) => message.role === "user").slice(-10).reverse();
  els.researchHistoryList.innerHTML = userMessages.length ? userMessages.map((message) => `
    <button class="research-history-item" type="button" data-scroll-target="${message.id}">
      ${escapeHtml(message.content.slice(0, 60))}${message.content.length > 60 ? "..." : ""}
      <small>${new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
    </button>`).join("") : `<p class="research-history-empty">No research questions yet.</p>`;
  els.researchHistoryList.querySelectorAll("[data-scroll-target]").forEach((button) => {
    button.addEventListener("click", () => document.getElementById(button.dataset.scrollTarget)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  });
}

function clearResearchConversation() {
  if (researchState.messages.length && !confirm("Clear this research conversation?")) return;
  researchState.history = [];
  researchState.messages = [];
  researchState.totalSources = 0;
  if (els.researchMessages) els.researchMessages.innerHTML = "";
  renderResearchEmptyState();
  renderResearchHistory();
  updateResearchCounts();
  fetch(`${API_BASE_URL}/api/research/chat`, { method: "DELETE" }).catch(() => null);
}

function updateResearchCounts() {
  if (els.researchMessageCount) els.researchMessageCount.textContent = String(researchState.messages.length);
  if (els.researchSourceCount) els.researchSourceCount.textContent = String(researchState.totalSources);
}

function scrollResearchToBottom() {
  if (els.researchMessages) els.researchMessages.scrollTop = els.researchMessages.scrollHeight;
}

const QBO_REPORT_GROUPS = {
  "tax-package": ["ProfitAndLoss", "BalanceSheet", "TrialBalance", "GeneralLedger"],
  "full-package": ["ProfitAndLoss", "ProfitAndLossDetail", "BalanceSheet", "TrialBalance", "GeneralLedger", "CashFlow", "AgedReceivables", "AgedPayables", "ExpensesByVendorSummary"],
  none: [],
};

async function initQBOSection() {
  if (!els.qboConnectPrompt) return;
  try {
    const status = await fetch(`${API_BASE_URL}/api/accounting/status`).then((r) => r.json());
    qboState.accountingAvailable = cloudProviders(status.available || []);
    qboState.accountingConnected = cloudProviders(status.connected || []);
    renderAccountingSoftwareGrid();
    const firstConnected = qboState.accountingConnected[0];
    if (firstConnected) {
      qboState.connected = true;
      qboState.activeSoftwareId = firstConnected.softwareId;
      qboState.companies = firstConnected.companies || [];
      await loadAccountingReports(firstConnected.softwareId);
      showQBOConnectedPanel();
    } else {
      qboState.connected = false;
      qboState.activeSoftwareId = qboState.accountingAvailable[0]?.softwareId || "quickbooks";
      els.qboConnectPrompt.hidden = false;
      els.qboConnectedPanel.hidden = true;
    }
  } catch (error) {
    console.warn("Could not initialize accounting connectors:", error);
  }
}

// Cloud accounting providers (QuickBooks + Xero); manual upload is not a card.
function cloudProviders(items) {
  return (Array.isArray(items) ? items : []).filter((item) => {
    const id = item?.softwareId || item?.id;
    return id && id !== "manual_upload";
  });
}

const ACCOUNTING_FALLBACKS = {
  quickbooks: { softwareId: "quickbooks", name: "QuickBooks Online", vendor: "Intuit", logo: "QBO", configured: false, connected: false, setupUrl: "https://developer.intuit.com", envVarsPresent: { QBO_CLIENT_ID: false, QBO_CLIENT_SECRET: false, QBO_REDIRECT_URI: false }, desc: "Pull P&L, Balance Sheet, Trial Balance, General Ledger and related reports." },
  xero: { softwareId: "xero", name: "Xero", vendor: "Xero", logo: "XE", configured: false, connected: false, setupUrl: "https://developer.xero.com", envVarsPresent: { XERO_CLIENT_ID: false, XERO_CLIENT_SECRET: false, XERO_REDIRECT_URI: false }, desc: "Pull P&L, Balance Sheet, Trial Balance and related reports." },
};

function accountingSoftwareDefinition(softwareId) {
  return qboState.accountingAvailable.find((item) => item.softwareId === softwareId)
    || ACCOUNTING_FALLBACKS[softwareId]
    || { softwareId, name: softwareId, vendor: "", logo: String(softwareId || "").slice(0, 2).toUpperCase(), configured: false, connected: false };
}

function renderAccountingSoftwareGrid() {
  if (!els.accountingSoftwareGrid) return;
  const providers = cloudProviders(qboState.accountingAvailable);
  const list = providers.length ? providers : [accountingSoftwareDefinition("quickbooks"), accountingSoftwareDefinition("xero")];
  els.accountingSoftwareGrid.innerHTML = list.map((software) => {
    const connected = qboState.accountingConnected.some((item) => item.softwareId === software.softwareId) || software.connected;
    const state = connected ? "connected" : software.configured ? "configured" : "locked";
    const label = connected ? "Connected" : software.configured ? `Connect ${software.name}` : "Setup required";
    const desc = software.desc || ACCOUNTING_FALLBACKS[software.softwareId]?.desc || "Pull financial reports for the workpaper.";
    return `
    <button class="accounting-software-card quickbooks-only ${state}" type="button" data-accounting-software="${escapeHtml(software.softwareId)}">
      <span class="accounting-logo">${escapeHtml(software.logo || "")}</span>
      <span class="accounting-card-copy">
        <span class="accounting-card-name">${escapeHtml(software.name || software.softwareId)}</span>
        <small>${escapeHtml(software.vendor || "")} · ${escapeHtml(desc)}</small>
      </span>
      <strong>${escapeHtml(label)}</strong>
    </button>`;
  }).join("");
  els.accountingSoftwareGrid.querySelectorAll("[data-accounting-software]").forEach((button) => {
    button.addEventListener("click", () => selectAccountingSoftware(button.dataset.accountingSoftware));
  });
  if (els.qboConnectBtn) els.qboConnectBtn.hidden = true;
  if (els.qboDisabledMsg) els.qboDisabledMsg.hidden = list.some((s) => s.configured);
}

async function selectAccountingSoftware(softwareId) {
  const software = accountingSoftwareDefinition(softwareId);
  if (!software) return;
  const live = accountingSoftwareById(softwareId);
  if (!live?.configured) {
    showAccountingSetupInstructions(software);
    return;
  }
  const connected = qboState.accountingConnected.some((item) => item.softwareId === softwareId) || live.connected;
  if (!connected) {
    connectQBO(softwareId);
    return;
  }
  await activateAccountingSoftware(softwareId);
}

function showAccountingSetupInstructions(software) {
  const envList = Object.keys(software.envVarsPresent || {}).join(", ") || "No environment variables required";
  const message = [
    `Set up ${software.name}`,
    `Developer portal: ${software.setupUrl || "N/A"}`,
    `Environment variables: ${envList}`,
    software.note || "",
    `Redirect URI: http://localhost:8080/auth/accounting/${software.softwareId}/callback`,
  ].filter(Boolean).join("\n\n");
  window.alert(message);
}

async function activateAccountingSoftware(softwareId) {
  qboState.activeSoftwareId = softwareId;
  const connected = qboState.accountingConnected.find((item) => item.softwareId === softwareId);
  qboState.companies = connected?.companies || [];
  qboState.selectedRealmId = "";
  qboState.selectedReports.clear();
  await loadAccountingReports(softwareId);
  showQBOConnectedPanel();
}

async function loadAccountingReports(softwareId) {
  const reports = await fetch(`${API_BASE_URL}/api/accounting/reports/available/${encodeURIComponent(softwareId)}`).then((r) => r.json()).catch(() => []);
  qboState.availableReports = Array.isArray(reports) ? reports : [];
  renderQBOCategoryTabs();
  renderQBOReportList(qboState.activeCategory);
}

function connectQBO(softwareId = "quickbooks") {
  const id = softwareId || qboState.activeSoftwareId || "quickbooks";
  const popup = window.open(`/auth/accounting/${encodeURIComponent(id)}`, "accountingAuth", "width=720,height=820,scrollbars=yes");
  if (!popup) {
    window.location.href = `/auth/accounting/${encodeURIComponent(id)}`;
    return;
  }
  const timer = window.setInterval(() => {
    if (popup.closed) {
      window.clearInterval(timer);
      initQBOSection();
    }
  }, 1000);
}

async function disconnectQBO() {
  const softwareId = qboState.activeSoftwareId || "quickbooks";
  const software = accountingSoftwareDefinition(softwareId);
  if (!window.confirm(`Disconnect ${software?.name || softwareId}?`)) return;
  await fetch(`${API_BASE_URL}/api/accounting/${encodeURIComponent(softwareId)}/disconnect`, { method: "POST" }).catch(() => null);
  qboState.connected = false;
  qboState.companies = [];
  qboState.selectedRealmId = "";
  els.qboConnectPrompt.hidden = false;
  els.qboConnectedPanel.hidden = true;
  await initQBOSection();
  showToast(`${software?.name || softwareId} disconnected.`, "info");
}

function showQBOConnectedPanel() {
  els.qboConnectPrompt.hidden = true;
  els.qboConnectedPanel.hidden = false;
  const software = accountingSoftwareDefinition(qboState.activeSoftwareId);
  document.getElementById("qbo-connected-label").textContent = `${software?.name || "Accounting software"} connected`;
  renderAccountingConnectedPicker();
  els.qboCompanySelect.innerHTML = `<option value="">Select a company</option>${qboState.companies.map((company) => `<option value="${escapeHtml(company.id || company.realmId)}">${escapeHtml(company.name || company.companyName || company.id || company.realmId)}</option>`).join("")}`;
  if (qboState.companies.length === 1) {
    els.qboCompanySelect.value = qboState.companies[0].id || qboState.companies[0].realmId;
    onQBOCompanyChange(els.qboCompanySelect.value);
  }
}

function accountingSoftwareById(softwareId) {
  return qboState.accountingAvailable.find((item) => item.softwareId === softwareId) || null;
}

// When more than one provider is connected, show chips to switch between them.
function renderAccountingConnectedPicker() {
  if (!els.accountingConnectedPicker) return;
  const connected = qboState.accountingConnected;
  if (connected.length <= 1) { els.accountingConnectedPicker.innerHTML = ""; return; }
  els.accountingConnectedPicker.innerHTML = connected.map((software) => `
    <button class="accounting-connected-chip ${software.softwareId === qboState.activeSoftwareId ? "active" : ""}" type="button" data-connected-software="${escapeHtml(software.softwareId)}">${escapeHtml(software.name || software.softwareId)}</button>`).join("");
  els.accountingConnectedPicker.querySelectorAll("[data-connected-software]").forEach((button) => {
    button.addEventListener("click", () => activateAccountingSoftware(button.dataset.connectedSoftware));
  });
}

function onQBOCompanyChange(realmId) {
  qboState.selectedRealmId = realmId;
  const hasCompany = Boolean(realmId);
  els.qboStepDates.hidden = !hasCompany;
  els.qboStepReports.hidden = !hasCompany;
  els.qboStepFetch.hidden = !hasCompany;
  if (!hasCompany) return;
  setQBOPreset("cy");
  selectQBOReportGroup("tax-package");
}

function setQBOPreset(preset, clickedButton = null) {
  const year = Number(document.getElementById("taxYear")?.value || new Date().getFullYear()) || new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);
  const ranges = {
    cy: [`${year}-01-01`, `${year}-12-31`],
    py: [`${year - 1}-01-01`, `${year - 1}-12-31`],
    q4: [`${year}-10-01`, `${year}-12-31`],
    q3: [`${year}-07-01`, `${year}-09-30`],
    ytd: [`${year}-01-01`, today],
  };
  document.querySelectorAll("[data-qbo-preset]").forEach((button) => button.classList.toggle("active", button === clickedButton || (!clickedButton && button.dataset.qboPreset === preset)));
  if (preset === "custom") {
    els.qboCustomDates.hidden = false;
    return;
  }
  els.qboCustomDates.hidden = false;
  [qboState.startDate, qboState.endDate] = ranges[preset] || ranges.cy;
  els.qboStartDate.value = qboState.startDate;
  els.qboEndDate.value = qboState.endDate;
  updateQBOFetchButton();
}

function renderQBOCategoryTabs() {
  const categories = ["all", "income", "balance", "detail", "payroll", "tax", "setup"];
  els.qboCategoryTabs.innerHTML = categories.map((category) => `<button class="qbo-cat-tab ${category === qboState.activeCategory ? "active" : ""}" type="button" data-qbo-category="${category}">${escapeHtml(category === "all" ? "All" : category)}</button>`).join("");
  els.qboCategoryTabs.querySelectorAll("[data-qbo-category]").forEach((button) => button.addEventListener("click", () => {
    qboState.activeCategory = button.dataset.qboCategory;
    renderQBOCategoryTabs();
    renderQBOReportList(qboState.activeCategory);
  }));
}

function renderQBOReportList(category = "all") {
  if (!els.qboReportList) return;
  const reports = category && category !== "all" ? qboState.availableReports.filter((report) => report.category === category) : qboState.availableReports;
  els.qboReportList.innerHTML = reports.map((report) => {
    const selected = qboState.selectedReports.has(report.id);
    return `<label class="qbo-report-item ${selected ? "selected" : ""}">
      <input type="checkbox" data-qbo-report="${escapeHtml(report.id)}" ${selected ? "checked" : ""} />
      <span class="qbo-report-info"><strong>${escapeHtml(report.name)}</strong><small>${report.dateRange ? "Date range" : report.asOfDate ? "As-of date" : "No date filter"}${report.supportsComparative ? " Â· comparative" : ""}</small></span>
    </label>`;
  }).join("") || `<p class="muted-note">No reports in this category.</p>`;
  els.qboReportList.querySelectorAll("[data-qbo-report]").forEach((input) => input.addEventListener("change", () => {
    if (input.checked) qboState.selectedReports.add(input.dataset.qboReport);
    else qboState.selectedReports.delete(input.dataset.qboReport);
    renderQBOReportList(qboState.activeCategory);
    updateQBOFetchButton();
  }));
}

function selectQBOReportGroup(groupId) {
  qboState.selectedReports.clear();
  (QBO_REPORT_GROUPS[groupId] || []).forEach((id) => qboState.selectedReports.add(id));
  renderQBOReportList(qboState.activeCategory);
  updateQBOFetchButton();
}

function updateQBOFetchButton() {
  const count = qboState.selectedReports.size;
  const ready = Boolean(qboState.selectedRealmId && qboState.startDate && qboState.endDate && count);
  els.qboStepFetch.hidden = !qboState.selectedRealmId;
  els.qboFetchBtn.disabled = !ready;
  const software = accountingSoftwareById(qboState.activeSoftwareId);
  els.qboFetchBtn.textContent = count ? `Pull ${count} Report${count === 1 ? "" : "s"} from ${software?.name || "Accounting"}` : "Pull Selected Reports";
}

async function fetchQBOReports() {
  const reportIds = Array.from(qboState.selectedReports);
  // Snapshot the download parameters ONCE so every selected report is pulled with
  // identical dates and accounting method. Period reports (P&L, Trial Balance) use the
  // full date range; point-in-time reports (Balance Sheet, agings) use the SAME period
  // end as their "as of" date. This guarantees a P&L for 1/1-12/31 and its matching
  // Balance Sheet as of 12/31 always line up — no drift between separate report types.
  const method = document.querySelector('input[name="qbo-method"]:checked')?.value || "Accrual";
  const comparative = Boolean(els.qboComparative?.checked);
  const params = { startDate: qboState.startDate, endDate: qboState.endDate, accountingMethod: method, cash: method === "Cash", comparative };
  if (!params.startDate || !params.endDate) {
    showToast("Set a date range before pulling reports.", "error");
    return;
  }
  els.qboFetchBtn.disabled = true;
  els.qboFetchStatus.hidden = false;
  const resolvedDateLabel = (reportId) => {
    const info = qboState.availableReports.find((report) => report.id === reportId) || {};
    if (info.asOfDate) return `as of ${params.endDate}`;
    if (info.dateRange) return `${params.startDate} → ${params.endDate}`;
    return "no date filter";
  };
  els.qboFetchStatus.innerHTML = `<div class="qbo-fetch-params">Applying to all: <strong>${escapeHtml(params.startDate)} → ${escapeHtml(params.endDate)}</strong> · <strong>${escapeHtml(method)}</strong> basis${comparative ? " · comparative" : ""}</div>`
    + reportIds.map((id) => `<div class="qbo-progress-item" id="qbo-progress-${escapeHtml(id)}"><span>...</span>${escapeHtml(qboReportName(id))} <small class="muted-note">(${escapeHtml(resolvedDateLabel(id))})</small></div>`).join("");
  try {
    const payload = {
      softwareId: qboState.activeSoftwareId,
      companyId: qboState.selectedRealmId,
      reports: reportIds.map((reportId) => {
        const info = qboState.availableReports.find((report) => report.id === reportId) || {};
        return { reportId, startDate: info.dateRange ? params.startDate : "", endDate: info.dateRange ? params.endDate : "", asOfDate: info.asOfDate ? params.endDate : "", comparative: Boolean(info.supportsComparative && comparative), accountingMethod: params.accountingMethod, cash: params.cash };
      }),
      outputFormat: "csv",
    };
    const response = await fetch(`${API_BASE_URL}/api/accounting/reports/fetch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Accounting API returned ${response.status}`);
    const files = (data.reports || []).map((report) => qboReportToFile(report));
    preparerFiles.packageFiles = mergeFiles(preparerFiles.packageFiles, files);
    qboReportsForReview = mergeFiles(qboReportsForReview, files);
    renderPreparerFiles();
    els.qboFetchStatus.innerHTML += `<div class="qbo-fetch-summary">${files.length} report${files.length === 1 ? "" : "s"} added to Preparation files.${data.errors?.length ? ` ${data.errors.length} failed.` : ""}</div>`;
    showToast(`${files.length} accounting report${files.length === 1 ? "" : "s"} added.`, "success");
    await autosaveSession({ qboReports: files.map((file) => ({ name: file.name, qboReportId: file.qboReportId, qboFetchedAt: file.qboFetchedAt })) }).catch(() => null);
  } catch (error) {
    els.qboFetchStatus.innerHTML = `<div class="validation-error">${escapeHtml(error.message || "Accounting report fetch failed.")}</div>`;
    showToast(error.message || "Accounting report fetch failed.", "error");
  } finally {
    updateQBOFetchButton();
  }
}

function qboReportName(reportId) {
  return qboState.availableReports.find((report) => report.id === reportId)?.name || reportId;
}

function qboReportToFile(report) {
  const company = qboState.companies.find((item) => (item.id || item.realmId) === qboState.selectedRealmId);
  const software = accountingSoftwareById(qboState.activeSoftwareId);
  const name = `${report.reportName || report.reportId} - ${report.startDate || ""}${report.endDate ? ` to ${report.endDate}` : ""}.csv`.replace(/[\\/:*?"<>|]+/g, "-");
  return { name, type: "text/csv", content: btoa(unescape(encodeURIComponent(report.csvContent || ""))), source: "accounting_software", accountingSoftwareId: qboState.activeSoftwareId, accountingSoftwareName: software?.name || "", qboReportId: report.reportId, qboRealmId: qboState.selectedRealmId, qboCompanyName: company?.name || company?.companyName || "", qboFetchedAt: report.fetchedAt, size: new Blob([report.csvContent || ""]).size };
}

const DRIVE_SVG = `<svg viewBox="0 0 87.3 78" aria-hidden="true"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>`;

const DRIVE_ZONE_CONFIG = {
  "prep-package": { title: "Select Preparation Files", subtitle: "Select prior-year workpapers, current-year reports, or ZIP packages", allowedTypes: ["pdf", "xlsx", "docx", "txt", "csv", "zip"], multiSelect: true },
  "review-package": { title: "Select Review Package Files", subtitle: "Select returns, workpapers, support documents, or ZIP packages", allowedTypes: ["pdf", "xlsx", "docx", "txt", "csv", "zip"], multiSelect: true },
  "knowledge-base": { title: "Select Knowledge Base Files", subtitle: "Select client-specific technical references", allowedTypes: ["pdf", "docx", "xlsx", "txt", "csv", "zip"], multiSelect: true },
  "review-examples": { title: "Select Review Example Files", subtitle: "Select sample reviews, notes, or formatting examples", allowedTypes: ["pdf", "docx", "txt", "zip"], multiSelect: true },
  "notice-document": { title: "Select Notice Document", subtitle: "Select the IRS or state notice", allowedTypes: ["pdf", "image"], multiSelect: false },
  "notice-prior-return": { title: "Select Prior Return", subtitle: "Select the prior-year return for context", allowedTypes: ["pdf", "docx"], multiSelect: false },
  "diagnostics-screenshot": { title: "Select Screenshot or Error File", subtitle: "Select an image, PDF, or text file with e-file errors", allowedTypes: ["image", "pdf", "txt"], multiSelect: false },
  "organizer-prior-return": { title: "Select Prior Year Return", subtitle: "Select the prior-year return to personalize the organizer", allowedTypes: ["pdf", "docx", "xlsx", "txt"], multiSelect: false },
  "presentation": { title: "Select Presentation Source Files", subtitle: "Select source materials for the presentation", allowedTypes: ["pdf", "xlsx", "docx", "txt", "csv", "zip", "image"], multiSelect: true },
  "calculation": { title: "Select Calculation Files", subtitle: "Select 1099s, W-2s, statements, financial reports, or PDFs", allowedTypes: ["pdf", "xlsx", "docx", "txt", "csv", "zip", "image"], multiSelect: true },
  "estimated-reviewed-workbook": { title: "Select Reviewed Workbook", subtitle: "Select the reviewed Excel workpaper to attach to the email", allowedTypes: ["xlsx"], multiSelect: false },
};

function setupDriveUploadButtons() {
  addDriveButtonAfterInput("prepPackageFiles", "prep-package");
  addDriveButtonAfterInput("reviewPackage", "review-package");
  addDriveButtonAfterInput("knowledgeUpload", "knowledge-base");
  addDriveButtonAfterInput("exampleUpload", "review-examples");
  addDriveButtonAfterInput("noticeFile", "notice-document");
  addDriveButtonAfterInput("noticePriorReturn", "notice-prior-return");
  addDriveButtonAfterInput("diagnosticsImage", "diagnostics-screenshot");
  addDriveButtonAfterInput("presentationFiles", "presentation");
  addDriveButtonAfterInput("calculationFiles", "calculation");
  addDriveButtonAfterInput("estReviewedWorkbookFile", "estimated-reviewed-workbook");
}

function addDriveButtonAfterInput(inputId, zoneId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const host = zoneId === "notice-prior-return"
    ? document.getElementById("noticePriorDriveHost")
    : input.closest("[data-drive-button-host]") || input.closest(".upload-card") || input.closest(".mini-upload") || input.parentElement;
  if (!host || document.getElementById(`drive-btn-${zoneId}`)) return;
  const wrap = document.createElement("div");
  wrap.className = zoneId === "notice-prior-return" ? "" : "drive-upload-row";
  // Always visible (like the hardcoded Estimated/Deliverable buttons). If Drive is not
  // connected, clicking prompts the connection via openDriveForZone.
  wrap.innerHTML = `<button class="drive-upload-btn" id="drive-btn-${zoneId}" type="button" data-drive-zone="${zoneId}" style="display:inline-flex">${DRIVE_SVG} Add from Google Drive</button>`;
  if (host.hasAttribute("data-drive-button-host") || zoneId === "notice-prior-return") host.appendChild(wrap);
  else host.insertAdjacentElement("afterend", wrap);
  wrap.querySelector("button").addEventListener("click", () => openDriveForZone(zoneId));
}

function setupDrivePickerDomEvents() {
  document.querySelectorAll("[data-drive-close]").forEach((button) => button.addEventListener("click", () => DrivePicker.close()));
  document.getElementById("drive-search-input")?.addEventListener("input", (event) => DrivePicker.handleSearch(event.target.value));
  document.getElementById("drive-search-clear")?.addEventListener("click", () => DrivePicker.clearSearch());
  document.getElementById("drive-select-all")?.addEventListener("change", (event) => DrivePicker.toggleSelectAll(event.target.checked));
  document.getElementById("drive-add-btn")?.addEventListener("click", () => DrivePicker.confirmSelection());
  document.getElementById("drive-load-more")?.addEventListener("click", () => DrivePicker.loadMoreFiles());
  document.getElementById("drive-my-drive-btn")?.addEventListener("click", () => DrivePicker.openMyDrive());
  document.getElementById("drive-shared-btn")?.addEventListener("click", () => DrivePicker.openSharedWithMe());
}

function openDriveForZone(zoneId) {
  const config = DRIVE_ZONE_CONFIG[zoneId];
  if (!config) return;
  if (!window.driveState?.connected) {
    showToast("Connect Google Drive to load files.", "info");
    connectGoogleDrive();
    return;
  }
  DrivePicker.open({
    ...config,
    onFilesSelected: (files) => addFilesToZone(zoneId, files),
  });
}

function connectGoogleDrive() {
  if (!window.driveState?.enabled) return;
  window.open("/auth/google", "google-drive-oauth", "width=520,height=720");
}

async function refreshDriveStatus() {
  try {
    const status = await fetch(`${API_BASE_URL}/api/drive/status`).then((response) => response.json());
    window.driveState = status;
    // Make sure a Drive button exists on every upload section (idempotent), then keep them all
    // visible — exactly like the hardcoded Estimated/Deliverable buttons. We intentionally do
    // NOT gate visibility on status.enabled/connected; clicking an unconnected button prompts
    // the Google connection via openDriveForZone. This guarantees the button shows on every tab.
    setupDriveUploadButtons();
    document.querySelectorAll(".drive-upload-btn").forEach((button) => {
      button.style.display = "inline-flex";
    });
    if (els.deliverableDriveConnectPrompt) els.deliverableDriveConnectPrompt.hidden = Boolean(status.connected);
    if (els.deliverableSelectFolder) els.deliverableSelectFolder.hidden = !status.connected;
    renderDriveHeaderStatus(status);
  } catch (error) {
    console.warn("Could not check Drive status:", error);
  }
}

function renderDriveHeaderStatus(status) {
  if (!els.driveHeaderStatus) return;
  if (!status?.enabled) {
    els.driveHeaderStatus.hidden = true;
    return;
  }
  els.driveHeaderStatus.hidden = false;
  els.driveHeaderStatus.textContent = status.connected ? `Drive: ${status.email || "connected"}` : "Connect Google Drive";
  els.driveHeaderStatus.classList.toggle("success", Boolean(status.connected));
}

function addFilesToZone(zoneId, driveFiles) {
  const files = driveFiles.map(normalizeDriveFile);
  if (zoneId === "prep-package") {
    preparerFiles.packageFiles = mergeFiles(preparerFiles.packageFiles, files);
    invalidateEntryGuideCache();
    renderPreparerFiles();
  } else if (zoneId === "review-package") {
    filesByType.taxReturns = mergeFiles(filesByType.taxReturns, files);
    renderFiles();
  } else if (zoneId === "notice-document") {
    noticeFiles.noticeFile = files[0] || null;
    renderNoticeFiles();
  } else if (zoneId === "notice-prior-return") {
    noticeFiles.priorReturn = files[0] || null;
    renderNoticeFiles();
  } else if (zoneId === "diagnostics-screenshot") {
    handleDiagnosticsDriveFile(files[0]);
  } else if (zoneId === "organizer-prior-return") {
    organizerFiles.priorYearReturn = files[0] || null;
    renderOrganizerFiles();
  } else if (zoneId === "knowledge-base" || zoneId === "review-examples") {
    uploadDriveContextFiles(zoneId === "knowledge-base" ? "knowledge_base" : "review_examples", files);
  } else if (zoneId === "presentation") {
    presentationState.files = mergeFiles(presentationState.files, files);
    renderPresentationFiles();
  } else if (zoneId === "calculation") {
    calculationState.files = mergeFiles(calculationState.files, files);
    renderCalculationFiles();
  } else if (zoneId === "estimated-reviewed-workbook") {
    const file = files[0];
    if (file) {
      estimatedTaxesState.reviewedWorkpaper = file;
      if (els.estReviewedWorkbookStatus) els.estReviewedWorkbookStatus.textContent = `${displayFileName(file)} ready to attach.`;
    }
  }
  showToast(`${files.length} file${files.length === 1 ? "" : "s"} added from Google Drive.`, "success");
}

function normalizeDriveFile(file) {
  return {
    name: file.name,
    type: file.type || guessMediaType(file.name),
    size: Number(file.size || 0),
    source: "google_drive",
    content: file.content,
    driveFileId: file.driveFileId,
    driveWebViewLink: file.driveWebViewLink,
    lastModified: Date.now(),
  };
}

function handleDiagnosticsDriveFile(file) {
  if (!file) return;
  if ((file.type || "").startsWith("image/")) {
    diagnosticsImageFile = file;
    renderDiagnosticsImagePreview();
  } else {
    els.diagnosticsErrorText.value = driveFileText(file);
  }
  updateDiagnosticsReadyState();
}

async function uploadDriveContextFiles(kind, files) {
  const prepared = [];
  for (const file of files) {
    prepared.push(...await prepareContextFiles(file));
  }
  if (!prepared.length) {
    showToast("No readable Drive files were found for the client library.", "warning");
    return;
  }
  const payload = {
    kind,
    files: prepared,
  };
  const response = await fetch(`${API_BASE_URL}/api/context/upload`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) showToast(result.error || "Could not upload Drive context files.", "error");
  else {
    showToast("Drive files added to client library.", "success");
    await loadServerConfig();
  }
}

function driveFileText(file) {
  try {
    return atob(file.content || "");
  } catch (_) {
    return file.content || "";
  }
}

function isDriveFile(file) {
  return file?.source === "google_drive";
}

function isBase64BackedFile(file) {
  return file?.source === "google_drive" || file?.source === "quickbooks_online" || file?.source === "accounting_software";
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64 || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function fileArrayBuffer(file) {
  if (isBase64BackedFile(file)) return base64ToArrayBuffer(file.content || "");
  return file.arrayBuffer();
}

async function fileTextContent(file) {
  if (isBase64BackedFile(file)) return driveFileText(file);
  return file.text();
}

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.classList.add("show"), 10);
  window.setTimeout(() => {
    toast.classList.remove("show");
    window.setTimeout(() => toast.remove(), 300);
  }, 3500);
}

class DrivePicker {
  static _instance = null;

  static open(config = {}) {
    if (!DrivePicker._instance) DrivePicker._instance = new DrivePicker();
    DrivePicker._instance.open(config);
  }

  static close() { DrivePicker._instance?.close(); }
  static handleSearch(query) { DrivePicker._instance?.handleSearch(query); }
  static clearSearch() { DrivePicker._instance?.clearSearch(); }
  static toggleSelectAll(checked) { DrivePicker._instance?.toggleSelectAll(checked); }
  static confirmSelection() { DrivePicker._instance?.confirmSelection(); }
  static loadMoreFiles() { DrivePicker._instance?.loadMoreFiles(); }
  static openMyDrive() { DrivePicker._instance?.openMyDrive(); }
  static openSharedWithMe() { DrivePicker._instance?.openSharedWithMe(); }

  constructor() {
    this.modal = document.getElementById("drive-picker-modal");
    this.state = {
      currentFolderId: "root",
      folderPath: [{ id: "root", name: "My Drive" }],
      selectedFiles: new Map(),
      loadedFiles: [],
      loadedFolders: [],
      nextPageToken: null,
      allowedTypes: ["pdf", "xlsx", "docx", "txt", "csv"],
      multiSelect: true,
      folderOnly: false,
      onFilesSelected: () => {},
      activeTypeFilter: "all",
      location: "my-drive",
      folderCache: new Map(),
    };
  }

  open(config = {}) {
    this.state.onFilesSelected = config.onFilesSelected || (() => {});
    this.state.allowedTypes = config.allowedTypes || ["pdf", "xlsx", "docx", "txt", "csv"];
    this.state.multiSelect = config.multiSelect !== false;
    this.state.folderOnly = Boolean(config.folderOnly);
    this.state.selectedFiles.clear();
    this.state.currentFolderId = config.folderId || "root";
    this.state.folderPath = [{ id: "root", name: "My Drive" }];
    this.state.location = "my-drive";
    document.getElementById("drive-picker-title").textContent = config.title || "Select Files from Google Drive";
    const subtitle = document.getElementById("drive-picker-subtitle");
    subtitle.textContent = config.subtitle || "";
    subtitle.style.display = config.subtitle ? "block" : "none";
    this.renderTypeFilters();
    document.getElementById("drive-type-filters").style.display = this.state.folderOnly ? "none" : "";
    this.modal.style.display = "flex";
    document.body.style.overflow = "hidden";
    this.loadFolder(this.state.currentFolderId);
  }

  close() {
    this.modal.style.display = "none";
    document.body.style.overflow = "";
  }

  async loadFolder(folderId, folderName = "My Drive") {
    this.state.currentFolderId = folderId;
    const existing = this.state.folderPath.findIndex((item) => item.id === folderId);
    this.state.folderPath = existing >= 0 ? this.state.folderPath.slice(0, existing + 1) : [...this.state.folderPath, { id: folderId, name: folderName }];
    const cached = this.state.folderCache.get(folderId);
    if (cached && Date.now() - cached.timestamp < 60000) {
      this.state.loadedFolders = cached.folders;
      this.state.loadedFiles = cached.files;
      this.renderFolders(cached.folders);
      this.renderFiles(cached.files);
      this.renderBreadcrumb();
      return;
    }
    this.showLoading("Loading folder...");
    try {
      const [foldersRes, filesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/drive/folders?parentId=${encodeURIComponent(folderId)}`).then((r) => r.json()),
        fetch(`${API_BASE_URL}/api/drive/files?folderId=${encodeURIComponent(folderId)}&fileTypes=${encodeURIComponent(this.state.allowedTypes.join(","))}`).then((r) => r.json()),
      ]);
      const folders = foldersRes.folders || [];
      const files = filesRes.files || [];
      this.state.nextPageToken = filesRes.nextPageToken || null;
      this.state.loadedFiles = files;
      this.state.loadedFolders = folders;
      this.state.folderCache.set(folderId, { folders, files, timestamp: Date.now() });
      this.renderFolders(folders);
      this.renderFiles(files);
      this.renderBreadcrumb();
    } catch (error) {
      this.showError(error.message || "Could not load Drive folder.");
    } finally {
      this.hideLoading();
    }
  }

  openMyDrive() {
    this.state.location = "my-drive";
    this.state.folderPath = [{ id: "root", name: "My Drive" }];
    document.getElementById("drive-folder-panel").style.display = "block";
    this.updateLocationButtons();
    this.loadFolder("root");
  }

  openSharedWithMe() {
    this.state.location = "shared";
    this.state.folderPath = [{ id: "shared-with-me", name: "Shared with me" }];
    document.getElementById("drive-folder-panel").style.display = "block";
    this.updateLocationButtons();
    this.loadFolder("shared-with-me", "Shared with me");
  }

  handleSearch(query) {
    window.clearTimeout(this.searchTimer);
    document.getElementById("drive-search-clear").style.display = query ? "block" : "none";
    if (!query.trim()) { this.clearSearch(); return; }
    this.searchTimer = window.setTimeout(async () => {
      this.showLoading("Searching Drive...");
      try {
        const res = await fetch(`${API_BASE_URL}/api/drive/search?q=${encodeURIComponent(query)}&fileTypes=${encodeURIComponent(this.state.allowedTypes.join(","))}`).then((r) => r.json());
        this.state.loadedFiles = res.files || [];
        this.state.nextPageToken = null;
        document.getElementById("drive-folder-panel").style.display = "none";
        this.renderFiles(this.state.loadedFiles);
      } catch (error) {
        this.showError(error.message || "Search failed.");
      } finally {
        this.hideLoading();
      }
    }, 400);
  }

  clearSearch() {
    document.getElementById("drive-search-input").value = "";
    document.getElementById("drive-search-clear").style.display = "none";
    document.getElementById("drive-folder-panel").style.display = "block";
    this.loadFolder(this.state.currentFolderId);
  }

  async loadMoreFiles() {
    if (!this.state.nextPageToken) return;
    this.showLoading("Loading more...");
    try {
      const res = await fetch(`${API_BASE_URL}/api/drive/files?folderId=${encodeURIComponent(this.state.currentFolderId)}&fileTypes=${encodeURIComponent(this.state.allowedTypes.join(","))}&pageToken=${encodeURIComponent(this.state.nextPageToken)}`).then((r) => r.json());
      this.state.loadedFiles = [...this.state.loadedFiles, ...(res.files || [])];
      this.state.nextPageToken = res.nextPageToken || null;
      this.renderFiles(this.state.loadedFiles);
    } finally {
      this.hideLoading();
    }
  }

  toggleFile(file) {
    if (!file) return;
    const key = `${file.kind || "file"}:${file.id}`;
    if (this.state.selectedFiles.has(key)) this.state.selectedFiles.delete(key);
    else {
      if (!this.state.multiSelect) this.state.selectedFiles.clear();
      this.state.selectedFiles.set(key, file);
    }
    this.renderFiles(this.state.loadedFiles);
    this.renderFolders(this.state.loadedFolders);
  }

  toggleSelectAll(checked) {
    if (this.state.folderOnly) return;
    if (checked) this.state.loadedFiles.forEach((file) => this.state.selectedFiles.set(`file:${file.id}`, { ...file, kind: "file" }));
    else this.state.selectedFiles.clear();
    this.renderFiles(this.state.loadedFiles);
    this.renderFolders(this.state.loadedFolders);
  }

  async confirmSelection() {
    const files = Array.from(this.state.selectedFiles.values());
    if (!files.length) return;
    if (this.state.folderOnly) {
      const folders = files.filter((file) => file.kind === "folder");
      this.close();
      this.state.onFilesSelected(folders);
      return;
    }
    const button = document.getElementById("drive-add-btn");
    button.disabled = true;
    button.textContent = "Reading files...";
    const loaded = [];
    for (const file of files) {
      this.showLoading(`Reading ${file.name}...`);
      if (file.kind === "folder") {
        const res = await fetch(`${API_BASE_URL}/api/drive/read-folder`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ folderId: file.id, folderName: file.name, fileTypes: this.state.allowedTypes.join(",") }),
        }).then((r) => r.json());
        if (res.files) {
          loaded.push(...res.files.map((item) => ({
            name: item.fileName,
            type: item.mimeType,
            content: item.contentBase64,
            source: "google_drive",
            driveFileId: item.driveFileId,
            driveWebViewLink: item.driveWebViewLink,
            size: item.sizeBytes,
          })));
          if (res.truncated) showToast(`Folder ${file.name} was limited to ${res.maxFiles} files.`, "warning");
        }
      } else {
        const res = await fetch(`${API_BASE_URL}/api/drive/read-file`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fileId: file.id, fileName: file.name, mimeType: file.mimeType }),
        }).then((r) => r.json());
        if (!res.error) loaded.push({ name: res.fileName, type: res.mimeType, content: res.contentBase64, source: "google_drive", driveFileId: file.id, driveWebViewLink: file.webViewLink, size: res.sizeBytes });
      }
    }
    this.hideLoading();
    this.close();
    button.textContent = "Add Files";
    if (loaded.length) this.state.onFilesSelected(loaded);
  }

  renderBreadcrumb() {
    document.getElementById("drive-breadcrumb").innerHTML = this.state.folderPath.map((item, index) => `<button type="button" class="drive-breadcrumb-item ${index === this.state.folderPath.length - 1 ? "current" : ""}" data-folder-id="${escapeHtml(item.id)}">${escapeHtml(item.name)}</button>${index < this.state.folderPath.length - 1 ? '<span class="drive-breadcrumb-sep">/</span>' : ""}`).join("");
    document.querySelectorAll(".drive-breadcrumb-item").forEach((button) => button.addEventListener("click", () => this.loadFolder(button.dataset.folderId, button.textContent)));
  }

  renderFolders(folders) {
    this.state.loadedFolders = folders;
    const el = document.getElementById("drive-folder-list");
    el.innerHTML = folders.length ? folders.map((folder) => {
      const selected = this.state.selectedFiles.has(`folder:${folder.id}`);
      return `<div class="drive-folder-item ${selected ? "selected" : ""}">
        <input type="checkbox" ${selected ? "checked" : ""} data-folder-select="${escapeHtml(folder.id)}" />
        <button type="button" class="drive-folder-open" data-folder-id="${escapeHtml(folder.id)}" data-folder-name="${escapeHtml(folder.name)}">Folder ${escapeHtml(folder.name)}</button>
      </div>`;
    }).join("") : '<div class="drive-empty-mini">No subfolders</div>';
    el.querySelectorAll(".drive-folder-open").forEach((button) => button.addEventListener("click", () => this.loadFolder(button.dataset.folderId, button.dataset.folderName)));
    el.querySelectorAll("[data-folder-select]").forEach((checkbox) => checkbox.addEventListener("change", () => {
      const folder = folders.find((item) => item.id === checkbox.dataset.folderSelect);
      this.toggleFile({ ...folder, kind: "folder" });
    }));
  }

  renderFiles(files) {
    const list = document.getElementById("drive-file-list");
    const empty = document.getElementById("drive-file-empty");
    const loadMore = document.getElementById("drive-load-more");
    document.getElementById("drive-file-count").textContent = `${files.length} file${files.length === 1 ? "" : "s"}`;
    empty.style.display = files.length ? "none" : "flex";
    loadMore.style.display = this.state.nextPageToken ? "block" : "none";
    list.innerHTML = files.map((file) => {
      const selected = this.state.selectedFiles.has(`file:${file.id}`);
      return `<div class="drive-file-item ${selected ? "selected" : ""}" data-file-id="${escapeHtml(file.id)}"><input type="checkbox" ${selected ? "checked" : ""} /><span class="drive-file-icon">${this.fileIcon(file.mimeType)}</span><div class="drive-file-info"><div class="drive-file-name">${escapeHtml(file.name)}</div><div class="drive-file-meta">${file.size ? formatBytes(Number(file.size)) : ""}</div></div>${file.webViewLink ? `<a href="${escapeHtml(file.webViewLink)}" target="_blank" class="drive-file-link">Open</a>` : ""}</div>`;
    }).join("");
    list.querySelectorAll(".drive-file-item").forEach((row) => {
      row.addEventListener("click", (event) => {
        if (event.target.tagName === "A") return;
        const file = files.find((item) => item.id === row.dataset.fileId);
        this.toggleFile(file ? { ...file, kind: "file" } : null);
      });
    });
    this.updateSelection();
  }

  renderTypeFilters() {
    const types = ["all", ...this.state.allowedTypes];
    document.getElementById("drive-type-filters").innerHTML = types.map((type) => `<button class="drive-type-filter-btn ${this.state.activeTypeFilter === type ? "active" : ""}" type="button" data-type="${escapeHtml(type)}">${escapeHtml(type.toUpperCase())}</button>`).join("");
    document.querySelectorAll(".drive-type-filter-btn").forEach((button) => button.addEventListener("click", () => {
      this.state.activeTypeFilter = button.dataset.type;
      this.state.folderCache.delete(this.state.currentFolderId);
      const original = this.state.allowedTypes;
      if (button.dataset.type !== "all") this.state.allowedTypes = [button.dataset.type];
      this.renderTypeFilters();
      this.loadFolder(this.state.currentFolderId).then(() => { this.state.allowedTypes = original; });
    }));
  }

  updateSelection() {
    const count = this.state.selectedFiles.size;
    const noun = this.state.folderOnly ? "folder" : "file";
    document.getElementById("drive-selection-summary").textContent = count ? `${count} ${noun}${count === 1 ? "" : "s"} selected` : `No ${noun}s selected`;
    const button = document.getElementById("drive-add-btn");
    button.disabled = !count;
    button.textContent = count ? `Add ${count} ${this.state.folderOnly ? "Folder" : "File"}${count === 1 ? "" : "s"}` : `Add ${this.state.folderOnly ? "Folder" : "Files"}`;
  }

  updateLocationButtons() {
    document.getElementById("drive-my-drive-btn")?.classList.toggle("active", this.state.location === "my-drive");
    document.getElementById("drive-shared-btn")?.classList.toggle("active", this.state.location === "shared");
  }

  showLoading(text) {
    document.getElementById("drive-loading-text").textContent = text || "Loading...";
    document.getElementById("drive-loading-indicator").style.display = "flex";
  }

  hideLoading() {
    document.getElementById("drive-loading-indicator").style.display = "none";
  }

  showError(message) {
    document.getElementById("drive-file-list").innerHTML = `<div class="drive-empty-state">${escapeHtml(message)}</div>`;
  }

  fileIcon(mimeType) {
    if ((mimeType || "").includes("pdf")) return "PDF";
    if ((mimeType || "").includes("spreadsheet") || (mimeType || "").includes("excel")) return "XLS";
    if ((mimeType || "").includes("document") || (mimeType || "").includes("word")) return "DOC";
    if ((mimeType || "").includes("image")) return "IMG";
    return "FILE";
  }
}

async function loadAuthStatus() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/status`);
    const payload = await response.json();
    if (!payload.authenticated) {
      window.location.href = "/login";
      return;
    }
    currentUsername = payload.username || "";
    currentUser = {
      username: payload.username || "",
      role: payload.role || "user",
      displayName: payload.displayName || payload.username || "",
    };
    document.body.classList.toggle("admin-mode", currentUser.role === "admin");
    document.querySelectorAll(".admin-only").forEach((element) => {
      element.hidden = currentUser.role !== "admin";
    });
    if (currentUser.role === "admin") {
      els.userStatus.textContent = currentUser.displayName ? `Admin: ${currentUser.displayName}` : "Admin";
      document.body.classList.remove("auth-loading");
      openAdminDashboard();
      return;
    }
    els.userStatus.textContent = currentUser.displayName ? `Signed in: ${currentUser.displayName}` : "Signed in";
    if (!els.deliverablePreparerName.value.trim()) els.deliverablePreparerName.value = currentUsername;
    document.body.classList.remove("auth-loading");
  } catch (_) {
    els.userStatus.textContent = "Auth unknown";
    document.body.classList.remove("auth-loading");
  }
}

async function logout() {
  await fetch(`${API_BASE_URL}/api/logout`, { method: "POST" }).catch(() => null);
  window.location.href = "/login";
}

async function runWithCostEstimate(action, params, apiFn) {
  return apiFn();
}

function showCostEstimateBanner(estimate, onConfirm, onCancel) {
  document.getElementById("cost-estimate-banner")?.remove();
  onConfirm?.();
}

async function openAdminDashboard() {
  if (currentUser.role !== "admin") return;
  els.adminDashboard.hidden = false;
  await loadAdminUsers().catch((error) => showAdminUserMessage(error.message || "Could not load users.", "error"));
}

function closeAdminDashboard() {
  if (currentUser.role === "admin") {
    logout();
    return;
  }
  els.adminDashboard.hidden = true;
}

function showAdminUserMessage(message, type = "success") {
  if (!els.adminUserMessage) return;
  els.adminUserMessage.hidden = false;
  els.adminUserMessage.textContent = message;
  els.adminUserMessage.classList.toggle("success", type !== "error");
  els.adminUserMessage.classList.toggle("error", type === "error");
}

async function loadAdminUsers() {
  if (!els.adminUsersList) return [];
  els.adminUsersList.innerHTML = `<div class="admin-user-row">Loading users...</div>`;
  const response = await fetch(`${API_BASE_URL}/api/admin/users`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Could not load users.");
  renderAdminUsers(payload.users || []);
  return payload.users || [];
}

function renderAdminUsers(users) {
  if (!els.adminUsersList) return;
  if (!users.length) {
    els.adminUsersList.innerHTML = `<div class="admin-user-row">No users created yet.</div>`;
    return;
  }
  els.adminUsersList.innerHTML = users.map((user) => {
    const username = user.username || "";
    const limit = user.spendLimitUsd ?? "";
    const used = formatUsd(user.spendUsedUsd || 0);
    const budgetText = user.spendHasLimit
      ? `Used ${used} / Limit ${formatUsd(user.spendLimitUsd || 0)} / Remaining ${formatUsd(user.spendRemainingUsd || 0)}`
      : `Used ${used} / No limit`;
    return `
      <article class="admin-user-row" data-admin-user="${escapeHtml(username)}">
        <div class="admin-user-identity">
          <strong>${escapeHtml(username)}</strong>
          <span>${escapeHtml(user.displayName || "")}</span>
          <span class="admin-user-spend">${escapeHtml(budgetText)}</span>
        </div>
        <label>
          <span>Display</span>
          <input data-admin-display="${escapeHtml(username)}" value="${escapeHtml(user.displayName || "")}" />
        </label>
        <label>
          <span>Role</span>
          <select data-admin-role="${escapeHtml(username)}">
            <option value="user"${user.role === "user" ? " selected" : ""}>User</option>
            <option value="admin"${user.role === "admin" ? " selected" : ""}>Admin</option>
          </select>
        </label>
        <label>
          <span>Status</span>
          <select data-admin-active="${escapeHtml(username)}">
            <option value="true"${user.active === false ? "" : " selected"}>Active</option>
            <option value="false"${user.active === false ? " selected" : ""}>Disabled</option>
          </select>
        </label>
        <label>
          <span>Budget USD</span>
          <input data-admin-limit="${escapeHtml(username)}" type="number" min="0" step="0.01" value="${escapeHtml(String(limit))}" placeholder="No limit" />
        </label>
        <div class="admin-user-actions">
          <button class="ghost-button small-button" type="button" data-admin-save="${escapeHtml(username)}">Save</button>
          <button class="ghost-button small-button" type="button" data-admin-password="${escapeHtml(username)}">Password</button>
          <button class="admin-danger-button" type="button" data-admin-delete="${escapeHtml(username)}">Delete</button>
        </div>
      </article>
    `;
  }).join("");
  bindAdminUserActions();
}

function bindAdminUserActions() {
  els.adminUsersList?.querySelectorAll("[data-admin-save]").forEach((button) => {
    button.addEventListener("click", () => updateAdminUser(button.dataset.adminSave));
  });
  els.adminUsersList?.querySelectorAll("[data-admin-password]").forEach((button) => {
    button.addEventListener("click", () => resetAdminUserPassword(button.dataset.adminPassword));
  });
  els.adminUsersList?.querySelectorAll("[data-admin-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteAdminUser(button.dataset.adminDelete));
  });
}

async function createAdminUser(event) {
  event.preventDefault();
  const username = els.adminNewUsername.value.trim();
  const password = els.adminNewPassword.value;
  const spendLimitUsd = els.adminNewSpendLimit.value;
  if (!username || !password) {
    showAdminUserMessage("Username and password are required.", "error");
    return;
  }
  const response = await fetch(`${API_BASE_URL}/api/admin/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      password,
      displayName: els.adminNewDisplayName.value.trim(),
      role: els.adminNewRole.value || "user",
      spendLimitUsd,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    showAdminUserMessage(payload.error || "Could not create user.", "error");
    return;
  }
  els.adminCreateUserForm.reset();
  if (els.adminNewRole) els.adminNewRole.value = "user";
  showAdminUserMessage(`User ${username} created.`);
  await loadAdminUsers();
}

async function updateAdminUser(username) {
  if (!username) return;
  const displayName = els.adminUsersList?.querySelector(`[data-admin-display="${cssEscape(username)}"]`)?.value || "";
  const role = els.adminUsersList?.querySelector(`[data-admin-role="${cssEscape(username)}"]`)?.value || "user";
  const active = els.adminUsersList?.querySelector(`[data-admin-active="${cssEscape(username)}"]`)?.value !== "false";
  const spendLimitUsd = els.adminUsersList?.querySelector(`[data-admin-limit="${cssEscape(username)}"]`)?.value ?? "";
  const response = await fetch(`${API_BASE_URL}/api/admin/users/${encodeURIComponent(username)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName, role, active, spendLimitUsd }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    showAdminUserMessage(payload.error || "Could not update user.", "error");
    return;
  }
  showAdminUserMessage(`User ${username} updated.`);
  await loadAdminUsers();
}

async function resetAdminUserPassword(username) {
  if (!username) return;
  const password = window.prompt(`New password for ${username}`);
  if (!password) return;
  const response = await fetch(`${API_BASE_URL}/api/admin/users/${encodeURIComponent(username)}/password`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    showAdminUserMessage(payload.error || "Could not reset password.", "error");
    return;
  }
  showAdminUserMessage(`Password updated for ${username}.`);
}

async function deleteAdminUser(username) {
  if (!username) return;
  if (!window.confirm(`Delete user ${username}? This cannot be undone.`)) return;
  const response = await fetch(`${API_BASE_URL}/api/admin/users/${encodeURIComponent(username)}`, { method: "DELETE" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    showAdminUserMessage(payload.error || "Could not delete user.", "error");
    return;
  }
  showAdminUserMessage(`User ${username} deleted.`);
  await loadAdminUsers();
}

function formatUsd(value) {
  const number = Number(value || 0);
  return `$${number.toFixed(2)}`;
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}


function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}


async function loadDashboardSessions() {
  const response = await fetch(`${API_BASE_URL}/api/sessions`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Could not load sessions.");
  dashboardSessions = payload.sessions || [];
  renderDashboard();
  return dashboardSessions;
}

async function openDashboard() {
  await loadDashboardSessions().catch(() => null);
  if (els.dashboardOverlay) els.dashboardOverlay.hidden = false;
}

function renderDashboard() {
  if (!els.dashboardRows) return;
  const query = (els.dashboardSearch?.value || "").toLowerCase();
  const rows = dashboardSessions.filter((session) => {
    const clientName = session.client?.name || "";
    return !query || `${clientName} ${session.returnType} ${session.taxYear} ${session.reviewStage} ${session.status}`.toLowerCase().includes(query);
  });
  const active = dashboardSessions.filter((session) => session.status !== "archived");
  if (els.statActiveSessions) els.statActiveSessions.textContent = active.length;
  if (els.statHighIssues) els.statHighIssues.textContent = active.filter((session) => (session.issues?.high || 0) > 0).length;
  if (els.statReadyToFile) els.statReadyToFile.textContent = active.filter((session) => dashboardStatus(session) === "READY TO FILE").length;
  if (els.statOverdue) els.statOverdue.textContent = active.filter((session) => isSessionOverdue(session)).length;
  els.dashboardRows.innerHTML = rows.length ? rows.map(renderDashboardRow).join("") : `<tr><td colspan="8">No sessions saved yet.</td></tr>`;
  bindDashboardRows();
}

function renderDashboardRow(session) {
  const clientName = session.client?.name || "Unnamed client";
  const status = dashboardStatus(session);
  return `
    <tr>
      <td>${escapeHtml(clientName)}</td>
      <td>${escapeHtml(session.returnType || "")}</td>
      <td>${escapeHtml(session.taxYear || "")}</td>
      <td>${escapeHtml(session.reviewStage || "")}</td>
      <td><span class="dashboard-status ${statusClass(status)}">${escapeHtml(status)}</span></td>
      <td>${session.issues?.high || 0}/${session.issues?.medium || 0}/${session.issues?.low || 0}</td>
      <td>${formatDateTime(session.updatedAt)}</td>
      <td class="dashboard-row-actions">
        <button class="ghost-button small-button" type="button" data-open-session="${session.id}">Open</button>
        <button class="ghost-button small-button" type="button" data-archive-session="${session.id}">Archive</button>
        <select data-status-session="${session.id}">
          <option value="in_progress"${session.status === "in_progress" ? " selected" : ""}>In progress</option>
          <option value="review_complete"${session.status === "review_complete" ? " selected" : ""}>Review complete</option>
          <option value="delivered"${session.status === "delivered" ? " selected" : ""}>Delivered</option>
          <option value="filed"${session.status === "filed" ? " selected" : ""}>Filed</option>
        </select>
      </td>
    </tr>`;
}

function bindDashboardRows() {
  document.querySelectorAll("[data-open-session]").forEach((button) => button.addEventListener("click", () => openSavedSession(button.dataset.openSession)));
  document.querySelectorAll("[data-archive-session]").forEach((button) => button.addEventListener("click", () => updateDashboardSession(button.dataset.archiveSession, { status: "archived" })));
  document.querySelectorAll("[data-status-session]").forEach((select) => select.addEventListener("change", () => updateDashboardSession(select.dataset.statusSession, { status: select.value })));
}

function dashboardStatus(session) {
  if (session.status === "delivered") return "DELIVERED";
  if ((session.issues?.high || 0) > 0) return "HIGH ISSUES";
  if (session.status === "review_complete") return "REVIEW COMPLETE";
  if (session.status === "filed") return "READY TO FILE";
  if (session.reviewResult && !(session.issues?.high || 0)) return "READY TO FILE";
  return "IN PROGRESS";
}

function statusClass(status) {
  return status.toLowerCase().replace(/\s+/g, "-");
}

function isSessionOverdue(_session) {
  return false;
}

async function updateDashboardSession(id, update) {
  await fetch(`${API_BASE_URL}/api/sessions/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(update) });
  await loadDashboardSessions();
}

async function startNewDashboardSession() {
  const clientName = window.prompt("Client name for the new review:");
  if (!clientName) return;
  const returnType = window.prompt("Return type:", "1040") || "";
  const taxYear = window.prompt("Tax year:", String(new Date().getFullYear())) || "";
  const response = await fetch(`${API_BASE_URL}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client: { name: clientName, returnType }, returnType, taxYear, reviewStage: "Initial review" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return;
  currentSessionId = payload.session.id;
  localStorage.setItem("taxapp_current_session_id", currentSessionId);
  applySessionToUi(payload.session, payload.client);
  els.dashboardOverlay.hidden = true;
  await loadDashboardSessions();
}

async function openSavedSession(id) {
  const response = await fetch(`${API_BASE_URL}/api/sessions/${id}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return;
  currentSessionId = id;
  localStorage.setItem("taxapp_current_session_id", id);
  applySessionToUi(payload.session, payload.client);
  els.dashboardOverlay.hidden = true;
}

function applySessionToUi(session, client) {
  document.getElementById("clientName").value = client?.name || "";
  document.getElementById("entityName").value = client?.name || "";
  document.getElementById("returnType").value = session.returnType || client?.returnType || "";
  document.getElementById("taxYear").value = session.taxYear || "";
  document.getElementById("reviewStage").value = normalizeReviewStage(session.reviewStage || "Initial review");
  els.deliverableClientName.value = client?.name || "";
  if (els.deliverableClientEmail) els.deliverableClientEmail.value = client?.email || "";
  if (els.deliverableClientCompany) els.deliverableClientCompany.value = client?.company || client?.name || "";
  if (client?.driveFolderId) deliverableState.clientFolder = { id: client.driveFolderId, name: client.driveFolderName || client.name || "Client folder" };
  els.organizerClientName.value = client?.name || "";
  els.organizerReturnType.value = session.returnType || "";
  els.organizerTaxYear.value = session.taxYear || "";
  if (session.reviewResult) {
    issueResolutionState = session.reviewResult.issueResponses || {};
    lastReview = { response: session.reviewResult, payload: { metadata: getMetadata() } };
    renderReviewResult(session.reviewResult, getMetadata());
    els.exportActions.hidden = false;
  }
  if (session.preparationResult) {
    lastPreparerOutput = { response: session.preparationResult, payload: {} };
    renderPreparerResult(session.preparationResult);
    els.prepExportActions.hidden = false;
  }
  if (session.noticeResult) {
    lastNoticeAnalysis = session.noticeResult;
    renderNoticeResult(lastNoticeAnalysis);
  }
  if (session.organizerResult) {
    lastOrganizerOutput = { organizer: session.organizerResult, response: {} };
    renderOrganizerResult(session.organizerResult, {});
    els.organizerExportActions.hidden = false;
  }
  if (session.diagnosticsResult) {
    lastDiagnosticsOutput = { diagnostics: session.diagnosticsResult, response: {} };
    renderDiagnosticsResult(session.diagnosticsResult, {});
  }
  if (session.deliverableResult) {
    lastDeliverableOutput = { response: session.deliverableResult, type: "email", payload: {} };
    if (session.deliverableResult?.draft || session.deliverableResult?.subject) renderDeliverableDraft(session.deliverableResult.draft || session.deliverableResult);
  }
  refreshDeliverableStatus();
  updateStepper();
}

async function checkRestoreSession() {
  if (!currentSessionId) return;
  const saved = dashboardSessions.find((session) => session.id === currentSessionId);
  if (!saved || saved.status === "archived") return;
  const clientName = saved.client?.name || "Unnamed client";
  if (window.confirm(`You have an unfinished session for ${clientName} - ${saved.returnType || "Return"} ${saved.taxYear || ""}. Continue?`)) {
    await openSavedSession(currentSessionId);
  }
}

async function autosaveSession(update = {}) {
  if (!currentSessionId) await ensureCurrentSession();
  if (!currentSessionId) return;
  const response = await fetch(`${API_BASE_URL}/api/sessions/${currentSessionId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...baseSessionPayload(), ...update }),
  });
  if (response.ok) {
    showSavedIndicator();
    await loadDashboardSessions().catch(() => null);
  }
}

async function ensureCurrentSession() {
  const metadata = getMetadata();
  const clientName = metadata.clientName || metadata.entityName || els.organizerClientName.value || els.deliverableClientName.value || "Unnamed client";
  const returnType = metadata.returnType || els.organizerReturnType.value || "";
  const taxYear = metadata.taxYear || els.organizerTaxYear.value || "";
  const response = await fetch(`${API_BASE_URL}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client: { name: clientName, returnType, entityType: els.organizerEntityType?.value || "" }, returnType, taxYear, reviewStage: metadata.reviewStage || "Initial review" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.ok && payload.session) {
    currentSessionId = payload.session.id;
    localStorage.setItem("taxapp_current_session_id", currentSessionId);
  }
}

function baseSessionPayload() {
  const metadata = getMetadata();
  return {
    client: { name: metadata.clientName || metadata.entityName || els.organizerClientName.value || els.deliverableClientName.value || "", returnType: metadata.returnType || els.organizerReturnType.value || "", entityType: els.organizerEntityType?.value || "" },
    taxYear: metadata.taxYear || els.organizerTaxYear.value || "",
    returnType: metadata.returnType || els.organizerReturnType.value || "",
    reviewStage: metadata.reviewStage || "Initial review",
  };
}

function showSavedIndicator() {
  els.saveIndicator.hidden = false;
  window.setTimeout(() => { els.saveIndicator.hidden = true; }, 1600);
}

async function exportAllData() {
  const response = await fetch(`${API_BASE_URL}/api/database/export`);
  const db = await response.json().catch(() => ({}));
  downloadBlob("ai-tax-agent-db.json", JSON.stringify(db, null, 2), "application/json");
}

async function clearAllData() {
  if (!window.confirm("Clear all saved clients and sessions? This cannot be undone.")) return;
  await fetch(`${API_BASE_URL}/api/database`, { method: "DELETE" });
  currentSessionId = "";
  localStorage.removeItem("taxapp_current_session_id");
  await loadDashboardSessions();
}

async function loadServerConfig() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/config`);
    serverConfig = await response.json();
    els.apiStatus.textContent = serverConfig.apiKeyConfigured ? "Claude API ready" : "Claude API missing";
    els.apiStatus.className = serverConfig.apiKeyConfigured ? "system-pill success" : "system-pill danger";
    els.webSearchStatus.textContent = serverConfig.webSearchEnabled ? "Web research: on" : "Web research: off";
    els.webSearchStatus.className = serverConfig.webSearchEnabled ? "system-pill success" : "system-pill";
    els.webSearchPolicy.textContent = serverConfig.webSearchEnabled
      ? `Enabled for Claude with up to ${serverConfig.webSearchMaxUses || 3} searches. Claude is instructed to prioritize official IRS/state sources.`
      : "Disabled by server. Enable with ENABLE_CLAUDE_WEB_SEARCH=true.";
    if (els.kbStatus) els.kbStatus.textContent = `Client KB: ${serverConfig.knowledgeBaseCount || 0}`;
    if (els.exampleStatus) els.exampleStatus.textContent = `Client examples: ${serverConfig.reviewExampleCount || 0}`;
    renderContextLists();
    if (!serverConfig.apiKeyConfigured) {
      renderValidation([{ blocks: true, text: "Server API key is missing. Set ANTHROPIC_API_KEY before running the app." }]);
    }
  } catch (error) {
    els.apiStatus.textContent = "Backend offline";
    els.apiStatus.className = "system-pill danger";
    renderMessage("warning", "Backend unavailable", "The application backend is not reachable. Check the production deployment status.");
  }
}

async function runReview(event) {
  event.preventDefault();

  const validation = validateBeforeReview({ showWarnings: true });
  renderValidation(validation);
  if (validation.some((item) => item.blocks)) {
    els.reviewStatus.textContent = "Needs attention";
    renderMessage("warning", "Review is not ready", "Resolve the blocking messages before running the senior review.");
    return;
  }

  setRunningState(true);
  renderProgress(["Validating files", "Preparing document text", "Sending grouped package to backend", "Waiting for Claude review"], 0);

  try {
    renderProgress(null, 1);
    const payload = await buildReviewPayload();
    renderValidation(validation);
    renderProgress(null, 2);
    renderProgress(null, 3);
    const apiResponse = await requestClaudeReview(payload);
    renderProgress(null, 4);
    const canonical = buildCanonicalReviewFromApi(apiResponse, payload);
    const response = {
      ...apiResponse,
      review: apiResponse.rawFallback || JSON.stringify(canonical || {}, null, 2),
      structured: canonical,
      issueResponses: apiResponse.issueResponses || {},
    };
    issueResolutionState = response.issueResponses || {};
    lastReview = { ...(canonical || {}), response, payload };
    invalidateEntryGuideCache();
    renderReviewResult(response, payload.metadata);
    refreshDeliverableStatus();
    els.exportActions.hidden = false;
    els.reviewStatus.textContent = "Complete";
    await autosaveSession({ reviewResult: response, status: "review_complete" });
  } catch (error) {
    els.reviewStatus.textContent = "Failed";
    renderMessage("warning", "Review failed", error.message || "The backend could not complete the review.");
  } finally {
    setRunningState(false);
  }
}

async function buildReviewPayload() {
  const qboReviewItems = qboReportsForReview.map((file) => ({ file, type: "workpapers" }));
  const allFiles = [...getAllFiles(), ...qboReviewItems];
  const preparedFiles = [];
  for (const item of allFiles) {
    preparedFiles.push(await prepareFileForReview(item));
  }

  return {
    metadata: {
      ...getMetadata(),
      qboReports: qboReportsForReview.map((file) => ({ name: file.name, reportId: file.qboReportId, companyName: file.qboCompanyName, software: file.accountingSoftwareName || "QuickBooks Online", fetchedAt: file.qboFetchedAt })),
      qboInstruction: qboReportsForReview.length ? "ACCOUNTING SOFTWARE DATA AVAILABLE: Reports pulled directly from connected accounting software are included as workpapers. Use them as authoritative book data for workpaper tie-out. Flag any difference between accounting software data and the return as a HIGH issue with the exact dollar difference." : "",
    },
    fileGroups: {
      taxReturns: preparedFiles.filter((file) => file.type === "taxReturns"),
      workpapers: preparedFiles.filter((file) => file.type === "workpapers"),
      documents: preparedFiles.filter((file) => file.type === "documents"),
    },
    files: preparedFiles,
  };
}

function getMetadata() {
  return {
    clientName: document.getElementById("clientName").value.trim(),
    entityName: document.getElementById("entityName").value.trim(),
    taxYear: document.getElementById("taxYear").value.trim(),
    returnType: document.getElementById("returnType").value,
    statesIncluded: document.getElementById("statesIncluded").value.trim(),
    reviewStage: normalizeReviewStage(document.getElementById("reviewStage").value),
    userNotes: document.getElementById("userNotes").value.trim(),
    clientFacts: document.getElementById("clientFacts").value.trim(),
    reviewTypes: getSelectedReviewTypes(),
  };
}

function normalizeReviewStage(stage) {
  return String(stage || "").toLowerCase().includes("final") ? "Final review" : "Initial review";
}

async function requestClaudeReview(payload) {
  const response = await runWithCostEstimate("review", {
    returnType: payload.metadata?.returnType || "",
    hasWorkpaper: Boolean(payload.fileGroups?.workpapers?.length),
  }, () => fetch(`${API_BASE_URL}/api/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }));

  const responsePayload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(responsePayload.error || `Backend returned ${response.status}`);
  // The backend uses a keep-alive heartbeat (always HTTP 200), so an error is reported in
  // the body even on a 200 response.
  if (responsePayload.error) throw new Error(responsePayload.error);
  return responsePayload;
}

function buildCanonicalReviewFromApi(res = {}, payload = {}) {
  const metadata = payload.metadata || {};
  const structured = res.review || res.structured || null;
  if (!structured && res.rawFallback) {
    return {
      clientName: res.meta?.clientName || metadata.entityName || metadata.clientName || "",
      returnType: res.meta?.returnType || metadata.returnType || "",
      taxYear: res.meta?.taxYear || metadata.taxYear || "",
      reviewStage: normalizeReviewStage(res.meta?.reviewStage || metadata.reviewStage || "Initial review"),
      generatedDate: res.meta?.generatedDate || new Date().toLocaleDateString(),
      reviewerName: res.meta?.reviewerName || "",
      executiveSummary: "Automatic structuring failed. The raw senior review output is shown below for manual review.",
      filingReadiness: "NOT READY",
      overallRiskScore: "High - automatic structuring failed",
      documentsRead: normalizeDocumentsRead(res.documentsRead),
      feedbackApplied: normalizeReviewStringArray(res.feedbackApplied),
      issues: [],
      checkboxReview: [],
      tieOutResults: [],
      balanceSheetCheck: null,
      openQuestions: [],
      verifiedItems: [],
      missingDocuments: [],
      finalConclusion: "Review requires manual inspection because the AI response could not be structured automatically.",
      rawFallback: res.rawFallback,
      structuringFailed: true,
      rawReviewOutput: res.rawFallback,
      truncated: Boolean(res.truncated),
    };
  }
  const normalized = normalizeReviewForExport({ structured }, metadata) || {};
  normalized.clientName = normalized.clientName || res.meta?.clientName || metadata.entityName || metadata.clientName || "";
  normalized.returnType = normalized.returnType || res.meta?.returnType || metadata.returnType || "";
  normalized.taxYear = normalized.taxYear || res.meta?.taxYear || metadata.taxYear || "";
  normalized.reviewStage = normalizeReviewStage(normalized.reviewStage || res.meta?.reviewStage || metadata.reviewStage || "Initial review");
  normalized.generatedDate = normalized.generatedDate || res.meta?.generatedDate || new Date().toLocaleDateString();
  normalized.reviewerName = normalized.reviewerName || res.meta?.reviewerName || "";
  if (!normalized.documentsRead?.length) normalized.documentsRead = normalizeDocumentsRead(res.documentsRead);
  if (!normalized.feedbackApplied?.length) normalized.feedbackApplied = normalizeReviewStringArray(res.feedbackApplied);
  normalized.rawFallback = res.rawFallback || null;
  normalized.truncated = Boolean(res.truncated);
  return normalized;
}

async function runNoticeAnalysis() {
  if (!noticeFiles.noticeFile) {
    renderNoticeMessage("warning", "Notice required", "Upload an IRS or state notice before analysis.");
    return;
  }

  els.analyzeNotice.disabled = true;
  els.noticeRunHint.textContent = "Analyzing notice...";
  els.noticeResults.innerHTML = `<article><span class="tag neutral">Running</span><h3>Analyzing notice...</h3><p>Claude is reviewing the notice, supporting documents, and response requirements.</p></article>`;

  try {
    const payload = {
      noticeFile: await prepareNoticeUpload(noticeFiles.noticeFile),
      priorReturn: noticeFiles.priorReturn ? await prepareNoticeUpload(noticeFiles.priorReturn) : null,
      clientFacts: els.noticeClientFacts.value.trim(),
      state: els.noticeState.value,
    };
    const response = await runWithCostEstimate("notices", {
      hasWorkpaper: Boolean(payload.priorReturn),
      hasImage: String(payload.noticeFile?.type || "").startsWith("image/"),
    }, () => fetch(`${API_BASE_URL}/api/notices`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }));
    const responsePayload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(responsePayload.error || `Backend returned ${response.status}`);
    lastNoticeAnalysis = responsePayload.notice || responsePayload;
    renderNoticeResult(lastNoticeAnalysis);
    refreshDeliverableStatus();
    await autosaveSession({ noticeResult: lastNoticeAnalysis });
  } catch (error) {
    renderNoticeMessage("warning", "Notice analysis failed", error.message || "The backend could not complete the notice analysis.");
  } finally {
    els.analyzeNotice.disabled = false;
    els.noticeRunHint.textContent = "The app will send the notice and supporting context to Claude.";
  }
}

async function prepareNoticeUpload(file) {
  const mediaType = file.type || guessMediaType(file.name);
  const ext = fileExtension(file.name).toLowerCase();
  if (mediaType === "application/pdf" || ["pdf", "png", "jpg", "jpeg"].includes(ext) || mediaType.startsWith("image/")) {
    return { name: displayFileName(file), type: mediaType || guessMediaType(file.name), content: await readAsBase64(file) };
  }
  return { name: displayFileName(file), type: mediaType || "text/plain", content: await fileTextContent(file) };
}

function renderNoticeFiles() {
  els.noticeFileCount.textContent = noticeFiles.noticeFile ? 1 : 0;
  els.noticePriorCount.textContent = noticeFiles.priorReturn ? 1 : 0;
  els.noticeInlineCount.textContent = noticeFiles.noticeFile ? 1 : 0;
  if (els.noticePriorReturnName) {
    els.noticePriorReturnName.textContent = noticeFiles.priorReturn ? displayFileName(noticeFiles.priorReturn) : "No file selected";
  }
  renderNoticeFileList(els.noticeFileList, noticeFiles.noticeFile, "No notice uploaded.");
  renderNoticeFileList(els.noticePriorList, noticeFiles.priorReturn, "No prior-year return uploaded.");
}

function renderNoticeFileList(list, file, emptyText) {
  if (!file) {
    list.innerHTML = `<li class="empty-state">${escapeHtml(emptyText)}</li>`;
    return;
  }
  list.innerHTML = `
    <li>
      <div>
        <div class="file-name">${escapeHtml(displayFileName(file))}${file.source === "quickbooks_online" || file.source === "accounting_software" ? ` <span class="qbo-badge">${escapeHtml(file.accountingSoftwareName || "QBO")}</span>` : ""}</div>
        <div class="file-meta">${formatBytes(file.size)} Â· ${escapeHtml(fileExtension(file.name))}</div>
      </div>
    </li>`;
}

function updateDiagnosticsInputMode() {
  const mode = document.querySelector('input[name="diagnosticsInputMode"]:checked')?.value || "text";
  els.diagnosticsTextPane.hidden = mode !== "text";
  els.diagnosticsImagePane.hidden = mode !== "image";
}

function updateDiagnosticsReadyState() {
  els.diagnosticsCharCount.textContent = els.diagnosticsErrorText.value.length;
  const ready = Boolean(els.diagnosticsSoftware.value) && (Boolean(els.diagnosticsErrorText.value.trim()) || Boolean(diagnosticsImageFile));
  els.analyzeDiagnostics.disabled = !ready;
  els.diagnosticsRunHint.textContent = ready ? "Ready to analyze e-file errors." : "Select tax software and provide error text or a screenshot.";
}

function handleDiagnosticsImageChange() {
  const file = Array.from(els.diagnosticsImage.files || [])[0] || null;
  if (file && file.size > 10 * 1024 * 1024) {
    window.alert("Screenshot must be 10MB or less.");
    els.diagnosticsImage.value = "";
    return;
  }
  diagnosticsImageFile = file;
  renderDiagnosticsImagePreview();
  updateDiagnosticsReadyState();
}

function renderDiagnosticsImagePreview() {
  if (!diagnosticsImageFile) {
    els.diagnosticsImagePreview.hidden = true;
    els.diagnosticsImagePreview.innerHTML = "";
    return;
  }
  const url = isDriveFile(diagnosticsImageFile)
    ? `data:${diagnosticsImageFile.type || guessMediaType(diagnosticsImageFile.name)};base64,${diagnosticsImageFile.content || ""}`
    : URL.createObjectURL(diagnosticsImageFile);
  els.diagnosticsImagePreview.hidden = false;
  els.diagnosticsImagePreview.innerHTML = `
    <button class="remove-file" type="button" id="removeDiagnosticsImage">Remove</button>
    <img src="${url}" alt="Diagnostic screenshot preview" />
    <small>${escapeHtml(displayFileName(diagnosticsImageFile))} - ${formatBytes(diagnosticsImageFile.size)}</small>`;
  document.getElementById("removeDiagnosticsImage").addEventListener("click", () => {
    diagnosticsImageFile = null;
    els.diagnosticsImage.value = "";
    renderDiagnosticsImagePreview();
    updateDiagnosticsReadyState();
  });
}

async function runDiagnostics() {
  if (els.analyzeDiagnostics.disabled) return;
  els.analyzeDiagnostics.disabled = true;
  els.diagnosticsStatus.textContent = "Running";
  const messages = ["Reading error messages...", "Identifying root causes...", `Building fix instructions for ${els.diagnosticsSoftware.value || "selected software"}...`, "Generating step-by-step guide..."];
  let messageIndex = 0;
  const timer = window.setInterval(() => {
    messageIndex = (messageIndex + 1) % messages.length;
    els.diagnosticsRunHint.textContent = messages[messageIndex];
  }, 1800);
  els.diagnosticsRunHint.textContent = messages[0];
  els.diagnosticsResults.innerHTML = `<article><span class="tag neutral">Running</span><h3>Analyzing e-file diagnostics</h3><p>${escapeHtml(messages[0])}</p></article>`;

  try {
    const payload = {
      errorInput: els.diagnosticsErrorText.value.trim(),
      errorImage: diagnosticsImageFile ? {
        name: displayFileName(diagnosticsImageFile),
        mimeType: diagnosticsImageFile.type || guessMediaType(diagnosticsImageFile.name),
        contentBase64: await readAsBase64(diagnosticsImageFile),
      } : null,
      taxSoftware: els.diagnosticsSoftware.value,
      returnType: els.diagnosticsReturnType.value,
      taxYear: els.diagnosticsTaxYear.value.trim(),
      additionalContext: els.diagnosticsContext.value.trim(),
    };
    const response = await runWithCostEstimate("diagnostics", {
      returnType: payload.returnType || "",
      hasImage: Boolean(payload.errorImage),
    }, () => fetch(`${API_BASE_URL}/api/diagnostics`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }));
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Backend returned ${response.status}`);
    lastDiagnosticsOutput = { response: result, diagnostics: result.diagnostics || {}, payload };
    renderDiagnosticsResult(lastDiagnosticsOutput.diagnostics, result);
    els.diagnosticsStatus.textContent = "Complete";
    await autosaveSession({ diagnosticsResult: lastDiagnosticsOutput.diagnostics, diagnosticsRunAt: new Date().toISOString() });
  } catch (error) {
    els.diagnosticsStatus.textContent = "Failed";
    renderDiagnosticsMessage("warning", "Diagnostics failed", error.message || "The backend could not analyze the errors.");
  } finally {
    window.clearInterval(timer);
    els.analyzeDiagnostics.disabled = false;
    updateDiagnosticsReadyState();
  }
}

function renderDiagnosticsResult(diagnostics, wrapper = {}) {
  const items = Array.isArray(diagnostics.diagnostics) ? diagnostics.diagnostics : [];
  const critical = items.filter((item) => item.type === "critical_efile_block").length;
  const warnings = items.filter((item) => item.type === "warning").length;
  els.diagnosticsCriticalCount.textContent = critical;
  els.diagnosticsWarningCount.textContent = warnings;
  if (!items.length) {
    els.diagnosticsResults.innerHTML = `<article class="diagnostics-summary-banner clear"><h3>No e-file errors detected in the provided input.</h3><p>If you are still experiencing issues, try pasting the full diagnostics text or uploading a clearer screenshot.</p></article>${renderCostSummary(wrapper)}`;
    return;
  }
  const bannerClass = diagnostics.canEfileNow ? (warnings ? "warning" : "clear") : "blocked";
  const bannerTitle = diagnostics.canEfileNow ? (warnings ? `E-file possible with warnings - ${warnings} warnings to review` : "No blocking errors found") : `Cannot e-file - ${critical || diagnostics.totalErrors || items.length} critical errors must be resolved`;
  els.diagnosticsResults.innerHTML = `
    <article class="diagnostics-summary-banner ${bannerClass}">
      <h3>${escapeHtml(bannerTitle)}</h3>
      <p><strong>Software:</strong> ${escapeHtml(diagnostics.softwareDetected || els.diagnosticsSoftware.value || "")} | <strong>Return:</strong> ${escapeHtml(diagnostics.returnTypeDetected || els.diagnosticsReturnType.value || "")} | <strong>Year:</strong> ${escapeHtml(diagnostics.taxYearDetected || els.diagnosticsTaxYear.value || "")}</p>
      <p>Critical errors: ${critical} | Warnings: ${warnings} | Est. fix time: ${escapeHtml(diagnostics.estimatedFixTime || "Not estimated")}</p>
      <p>${escapeHtml(diagnostics.summary || "")}</p>
      ${diagnostics.softwareDetected && els.diagnosticsSoftware.value && diagnostics.softwareDetected !== els.diagnosticsSoftware.value ? `<p class="diagnostics-note">Note: The screenshot appears to be from ${escapeHtml(diagnostics.softwareDetected)}. Fix instructions were generated for ${escapeHtml(els.diagnosticsSoftware.value)} as specified.</p>` : ""}
    </article>
    ${renderDiagnosticsRootCauses(diagnostics.rootCauses)}
    <article><span class="tag neutral">Diagnostics</span><h3>Error-by-error fix guide</h3><div class="diagnostics-card-stack">${items.map((item, index) => renderDiagnosticCard(item, index, diagnostics.rootCauses || [])).join("")}</div></article>
    ${renderDiagnosticsChecklist(diagnostics.postFixChecklist)}
    <div class="diagnostics-actions-bar"><button id="copyDiagnosticsText" class="ghost-button small-button" type="button">Copy All Errors as Text</button><button id="downloadDiagnosticsDocx" class="primary-button small-button" type="button">Download Fix Guide (.docx)</button><button id="analyzeDiagnosticsAgain" class="ghost-button small-button" type="button">Analyze Again</button></div>
    ${renderCostSummary(wrapper)}`;
  bindDiagnosticsResultActions();
}

function renderDiagnosticsRootCauses(rootCauses = []) {
  if (!Array.isArray(rootCauses) || !rootCauses.length) return "";
  return `<details class="diagnostics-root-causes" open><summary>Root Causes - Fix These First</summary>${rootCauses.map((cause, index) => `<article class="root-cause-card" id="diagnostics-root-${index + 1}"><strong>Root Cause: ${escapeHtml(cause.rootCause || "")}</strong>${cause.fixThisFirst ? `<span class="tag warning">START HERE</span>` : ""}<p>Fixing this will also resolve: ${escapeHtml((cause.affectsErrors || []).join(", ") || "related diagnostics")}</p></article>`).join("")}</details>`;
}

function renderDiagnosticCard(item, index, rootCauses) {
  const type = item.type || "informational";
  const isCritical = type === "critical_efile_block";
  const badge = isCritical ? "BLOCKS E-FILE" : type === "warning" ? "WARNING" : "INFO";
  const root = item.rootCauseId ? rootCauses.find((cause, causeIndex) => String(item.rootCauseId) === String(cause.id || causeIndex + 1)) : null;
  return `<details class="diagnostic-card ${type}" ${isCritical ? "open" : ""}><summary><span class="diagnostic-type ${type}">${escapeHtml(badge)}</span><strong>${escapeHtml(item.errorCode || item.softwareRef || item.id || `Error ${index + 1}`)}</strong><span>${escapeHtml(item.formOrSchedule || "")}</span><label class="fixed-check"><input type="checkbox" /> Mark as Fixed</label></summary>${root ? `<a class="root-link" href="#diagnostics-root-${rootCauses.indexOf(root) + 1}">Part of Root Cause: ${escapeHtml(root.rootCause)} -></a>` : ""}<pre class="diagnostic-raw">${escapeHtml(item.rawErrorText || "")}</pre><p><strong>What this means:</strong> ${escapeHtml(item.plainExplanation || "")}</p><p><strong>Affected area:</strong> ${escapeHtml(item.formOrSchedule || "N/A")} | ${escapeHtml(item.lineOrField || "N/A")}</p><div class="fix-steps"><h4>How to fix in ${escapeHtml(els.diagnosticsSoftware.value || "the software")}:</h4>${(item.fixSteps || []).map((step, stepIndex) => `<div class="fix-step"><span>${Number(step.step || stepIndex + 1)}</span><div><p>${escapeHtml(step.instruction || "")}</p>${step.screenPath ? `<code>&gt; ${escapeHtml(step.screenPath)}</code>` : ""}${step.expectedValue ? `<small class="expected-value">Set to: ${escapeHtml(step.expectedValue)}</small>` : ""}${step.warning ? `<small class="step-warning">${escapeHtml(step.warning)}</small>` : ""}</div></div>`).join("")}</div><p><strong>To confirm the fix:</strong> ${escapeHtml(item.verificationStep || "")}</p>${item.irsReference ? `<p><strong>IRS Reference:</strong> ${escapeHtml(item.irsReference)}</p>` : ""}</details>`;
}

function renderDiagnosticsChecklist(items = []) {
  if (!Array.isArray(items) || !items.length) return "";
  return `<article><span class="tag neutral">Checklist</span><h3>After Fixing All Errors - Run Through This Checklist</h3><ul class="diagnostics-checklist">${items.map((item) => `<li><label><input type="checkbox" /> ${escapeHtml(item)}</label></li>`).join("")}</ul></article>`;
}

function bindDiagnosticsResultActions() {
  document.getElementById("copyDiagnosticsText")?.addEventListener("click", copyDiagnosticsText);
  document.getElementById("downloadDiagnosticsDocx")?.addEventListener("click", downloadDiagnosticsDocx);
  document.getElementById("analyzeDiagnosticsAgain")?.addEventListener("click", () => { els.diagnosticsResults.innerHTML = `<article class="feed-empty"><span class="tag neutral">Pending</span><h3>No diagnostics analyzed yet</h3><p>Paste e-file errors or upload a screenshot, then click Analyze Errors.</p></article>`; els.diagnosticsErrorText.focus(); });
}

function diagnosticsToText(diagnostics = lastDiagnosticsOutput?.diagnostics || {}) {
  const lines = ["E-File Diagnostic Report", "", "Summary", diagnostics.summary || ""];
  (diagnostics.rootCauses || []).forEach((cause, index) => lines.push("", `Root Cause ${index + 1}: ${cause.rootCause}`, `Affects: ${(cause.affectsErrors || []).join(", ")}`));
  (diagnostics.diagnostics || []).forEach((item, index) => {
    lines.push("", `${index + 1}. ${item.errorCode || item.softwareRef || item.id || "Diagnostic"} - ${item.type}`, `Raw: ${item.rawErrorText || ""}`, `Meaning: ${item.plainExplanation || ""}`, "Fix steps:");
    (item.fixSteps || []).forEach((step) => lines.push(`${step.step}. ${step.instruction}${step.screenPath ? ` (${step.screenPath})` : ""}`));
    lines.push(`Verification: ${item.verificationStep || ""}`);
  });
  lines.push("", "Post-fix checklist");
  (diagnostics.postFixChecklist || []).forEach((item) => lines.push(`[ ] ${item}`));
  return lines.join("\n");
}

async function copyDiagnosticsText() {
  await navigator.clipboard?.writeText(diagnosticsToText());
}

async function downloadDiagnosticsDocx() {
  const diagnostics = lastDiagnosticsOutput?.diagnostics;
  if (!diagnostics) return;
  const today = new Date().toLocaleDateString();
  const text = ["E-File Diagnostic Report", `${diagnostics.softwareDetected || els.diagnosticsSoftware.value} - ${diagnostics.returnTypeDetected || els.diagnosticsReturnType.value} ${diagnostics.taxYearDetected || els.diagnosticsTaxYear.value} - ${today}`, "", diagnosticsToText(diagnostics), "", "Generated by AI Senior Tax Reviewer"].join("\n");
  await downloadWordDocument("e-file-diagnostic-report.docx", text);
}

function renderDiagnosticsMessage(type, title, message) {
  const tagClass = type === "warning" ? "warning" : "neutral";
  els.diagnosticsResults.innerHTML = `<article><span class="tag ${tagClass}">${type === "warning" ? "Attention" : "Info"}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p></article>`;
}

function renderNoticeResult(notice) {
  const urgency = String(notice.urgencyLevel || "LOW").toUpperCase();
  const deadlineClass = notice.deadlineWarning ? "deadline-warning" : "";
  els.noticeResults.innerHTML = `
    <article class="notice-result">
      <div class="urgency-banner urgency-${escapeHtml(urgency.toLowerCase())}">${escapeHtml(urgency)} urgency</div>
      <div class="notice-meta-grid">
        <div><span>Notice type</span><strong>${escapeHtml(notice.noticeType || "Not stated")}</strong></div>
        <div><span>Issuing authority</span><strong>${escapeHtml(notice.issuingAuthority || "Not stated")}</strong></div>
        <div><span>Tax year</span><strong>${escapeHtml(notice.taxYearAtIssue || "Not stated")}</strong></div>
        <div><span>Amount at issue</span><strong>${escapeHtml(notice.amountAtIssue || "Not stated")}</strong></div>
      </div>
      <section><h3>Response deadline</h3><p class="${deadlineClass}">${escapeHtml(notice.responseDeadline || "Not stated")}${notice.deadlineWarning ? ` â€” ${escapeHtml(notice.deadlineWarning)}` : ""}</p></section>
      <section><h3>Summary</h3><p>${escapeHtml(notice.summary || "")}</p></section>
      <section><h3>Analysis</h3><p>${escapeHtml(notice.analysis || "")}</p></section>
      <section><h3>Immediate Actions</h3><ul class="checklist-list">${(notice.immediateActions || []).map((item) => `<li><label><input type="checkbox" /> ${escapeHtml(item)}</label></li>`).join("") || "<li>None listed.</li>"}</ul></section>
      <section>
        <div class="letter-heading">
          <h3>Response Letter</h3>
          <div>
            <button class="ghost-button" type="button" id="copyNoticeLetter">Copy to clipboard</button>
            <button class="primary-button small-button" type="button" id="downloadNoticeLetter">Download as .docx</button>
          </div>
        </div>
        <pre class="response-letter-box">${escapeHtml(notice.responseLetter || "")}</pre>
      </section>
      <section><h3>Enclosures</h3><ul>${(notice.enclosures || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>None listed.</li>"}</ul></section>
      <section class="internal-notes"><h3>Preparer notes â€” do not share with client</h3><p>${escapeHtml(notice.internalNotes || "")}</p></section>
    </article>`;
  document.getElementById("copyNoticeLetter").addEventListener("click", () => navigator.clipboard?.writeText(notice.responseLetter || ""));
  document.getElementById("downloadNoticeLetter").addEventListener("click", () => downloadNoticeLetter(notice));
}

async function downloadNoticeLetter(notice) {
  const clientName = document.getElementById("clientName")?.value.trim() || "Taxpayer";
  const letter = [
    "[CPA Firm Name] | [Address] | [Phone]",
    "",
    new Date().toLocaleDateString(),
    "",
    `Re: ${notice.noticeType || "Tax Notice"} â€” ${clientName} â€” ${notice.taxYearAtIssue || "Tax Year"}`,
    "",
    notice.responseLetter || "",
    "",
    "Sincerely,",
    "[Preparer Name], CPA",
    "",
    "Enclosures:",
    ...(notice.enclosures || []).map((item) => `- ${item}`),
  ].join("\n");
  const fileName = `${notice.noticeType || "notice"}-response-letter.docx`.replace(/[^a-z0-9.-]+/gi, "-");
  await downloadWordDocument(fileName, letter);
}

function renderNoticeMessage(type, title, message) {
  const tagClass = type === "warning" ? "warning" : "neutral";
  els.noticeResults.innerHTML = `<article><span class="tag ${tagClass}">${type === "warning" ? "Attention" : "Info"}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p></article>`;
}

function resetNoticeTab() {
  noticeFiles.noticeFile = null;
  noticeFiles.priorReturn = null;
  lastNoticeAnalysis = null;
  els.noticeClientFacts.value = "";
  els.noticeState.value = "Federal / IRS";
  renderNoticeFiles();
  refreshDeliverableStatus();
  els.noticeResults.innerHTML = `<article class="feed-empty"><span class="tag neutral">Pending</span><h3>Waiting for notice</h3><p>Upload a notice document and click Analyze Notice.</p></article>`;
}

function populateNoticeStates() {
  const states = ["Federal / IRS", "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"];
  els.noticeState.innerHTML = states.map((state) => `<option>${state}</option>`).join("");
}

function setupDatabaseEvents() {
  document.querySelectorAll("[data-database-tab]").forEach((button) => button.addEventListener("click", () => switchDatabaseTab(button.dataset.databaseTab)));
  document.querySelectorAll("[data-client-tab]").forEach((button) => button.addEventListener("click", () => {
    databaseState.activeClientTab = button.dataset.clientTab || "profile";
    document.querySelectorAll("[data-client-tab]").forEach((item) => item.classList.toggle("active", item === button));
    renderDatabaseClientDetail();
  }));
  els.databaseRefreshClients?.addEventListener("click", loadDatabaseClients);
  els.databaseClientSearch?.addEventListener("input", renderDatabaseClients);
  els.requestClientSearch?.addEventListener("input", renderRequestClientOptions);
  els.requestSearchButton?.addEventListener("click", searchClientFiles);
  els.requestSearchInput?.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); searchClientFiles(); } });
  els.requestSelectAllVisible?.addEventListener("change", () => toggleRequestSelectAll(els.requestSelectAllVisible.checked));
  els.generateRequestEmail?.addEventListener("click", generateRequestEmail);
  document.querySelectorAll("[data-request-filter]").forEach((button) => button.addEventListener("click", () => applyQuickFilter(button.dataset.requestFilter, button)));
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && databaseState.activeTab === "requests") {
      event.preventDefault();
      els.requestSearchInput?.focus();
    }
  });
  els.databaseSaveGlobalInstructions?.addEventListener("click", saveDatabaseGlobalInstructions);
  els.databaseGlobalInstructions?.addEventListener("input", () => {
    if (els.databaseGlobalTokenEstimate) els.databaseGlobalTokenEstimate.textContent = "";
  });
  els.databaseAddLibraryItem?.addEventListener("click", addDatabaseLibraryItem);
  els.databaseRebuildDeadlines?.addEventListener("click", rebuildDatabaseDeadlines);
  els.databaseAddLearning?.addEventListener("click", addDatabaseLearning);
  els.databaseSubmitFeedback?.addEventListener("click", submitDatabaseFeedback);
}

function switchDatabaseTab(tab) {
  databaseState.activeTab = tab || "clients";
  document.querySelectorAll("[data-database-tab]").forEach((button) => button.classList.toggle("active", button.dataset.databaseTab === databaseState.activeTab));
  document.querySelectorAll(".database-pane").forEach((pane) => pane.classList.remove("active"));
  const paneId = `database${databaseState.activeTab.charAt(0).toUpperCase()}${databaseState.activeTab.slice(1)}Pane`;
  document.getElementById(paneId)?.classList.add("active");
  if (databaseState.activeTab === "requests") {
    refreshDeliverableStatus();
    if (!requestState.selectedClientId && databaseState.selectedClientId) selectRequestClient(databaseState.selectedClientId);
  }
  loadDatabaseData();
}

async function loadDatabaseData() {
  await Promise.allSettled([loadDatabaseClients(), loadDatabaseLibrary(), loadDatabaseDeadlines(), loadDatabaseLearning(), loadDatabaseFeedback()]);
}

async function loadDatabaseClients() {
  const data = await fetch(`${API_BASE_URL}/api/clients`).then((res) => res.json()).catch(() => ({ clients: [] }));
  databaseState.clients = data.clients || [];
  if (els.organizerPriorCount) els.organizerPriorCount.textContent = databaseState.clients.length;
  renderDatabaseClients();
  renderRequestClientOptions();
  refreshPrepSoftwareFromClient();
}

function renderDatabaseClients() {
  if (!els.databaseClientList) return;
  const query = (els.databaseClientSearch?.value || "").toLowerCase();
  const clients = databaseState.clients.filter((client) => [client.name, client.returnType, client.entityType, client.ein].join(" ").toLowerCase().includes(query));
  els.databaseClientList.innerHTML = clients.length ? clients.map((client) => `
    <button class="database-list-item ${client.id === databaseState.selectedClientId ? "active" : ""}" type="button" data-database-client="${escapeHtml(client.id)}">
      <strong>${escapeHtml(client.name || "Unnamed client")}</strong>
      <span>${escapeHtml(client.returnType || client.entityType || "No return type")}${client.ein ? ` - EIN ${escapeHtml(client.ein)}` : ""}</span>
    </button>
  `).join("") : `<div class="database-empty">No clients found.</div>`;
  els.databaseClientList.querySelectorAll("[data-database-client]").forEach((button) => button.addEventListener("click", () => {
    databaseState.selectedClientId = button.dataset.databaseClient;
    databaseState.activeClientTab = "profile";
    renderDatabaseClients();
    renderDatabaseClientDetail();
  }));
}

function selectedDatabaseClient() {
  return databaseState.clients.find((client) => client.id === databaseState.selectedClientId) || null;
}

function requestClientEmail(client) {
  return client?.email || client?.contactEmail || client?.clientEmail || client?.primaryEmail || "";
}

function renderRequestClientOptions() {
  if (!els.requestClientOptions) return;
  const query = (els.requestClientSearch?.value || "").toLowerCase();
  const clients = databaseState.clients.filter((client) => [
    client.name,
    client.entityType,
    client.returnType,
    client.ein,
    requestClientEmail(client),
  ].join(" ").toLowerCase().includes(query));
  els.requestClientOptions.innerHTML = clients.length ? clients.map((client) => `
    <button class="database-list-item ${client.id === requestState.selectedClientId ? "active" : ""}" type="button" data-request-client="${escapeHtml(client.id)}">
      <strong>${escapeHtml(client.name || "Unnamed client")}</strong>
      <span>${escapeHtml(client.entityType || "Entity")} - ${escapeHtml(client.returnType || "No return type")}${requestClientEmail(client) ? ` - ${escapeHtml(requestClientEmail(client))}` : " - no email"}</span>
    </button>
  `).join("") : `<div class="database-empty">No clients found.</div>`;
  els.requestClientOptions.querySelectorAll("[data-request-client]").forEach((button) => button.addEventListener("click", () => selectRequestClient(button.dataset.requestClient)));
}

function selectRequestClient(clientId) {
  const client = databaseState.clients.find((item) => item.id === clientId);
  if (!client) return;
  requestState.selectedClientId = clientId;
  requestState.selectedClient = client;
  requestState.searchResults = [];
  requestState.selectedFiles = [];
  requestState.generatedEmail = null;
  if (els.requestClientSearch) els.requestClientSearch.value = client.name || "";
  renderRequestClientOptions();
  renderRequestClientSummary();
  populateRequestYearFilter();
  renderRequestResults([]);
  renderSelectedFilesPanel();
  renderRequestEmailPreview(null);
  renderRequestHistory();
  updateRequestSteps();
}

function renderRequestClientSummary() {
  if (!els.requestClientSummary) return;
  const client = requestState.selectedClient;
  if (!client) {
    els.requestClientSummary.innerHTML = "";
    return;
  }
  const email = requestClientEmail(client);
  const documents = client.documents || [];
  els.requestClientSummary.innerHTML = `
    <div class="client-summary-card">
      <div class="client-summary-name">${escapeHtml(client.name || "Unnamed client")}</div>
      <div class="client-summary-meta">EIN: ${escapeHtml(client.ein || "Not saved")} | ${escapeHtml(client.returnType || "No return type")} | ${escapeHtml(client.state || client.taxState || "No state")}</div>
      <div class="client-summary-email">${email ? escapeHtml(email) : "No email on file"}</div>
      <div class="client-summary-meta">Drive folder: ${client.driveFolderId ? "linked" : "not linked"} | ${documents.length} files in DB</div>
      ${email ? "" : `<div class="inline-warning">No email on file for this client. Add an email before sending.</div>`}
    </div>`;
}

function populateRequestYearFilter() {
  if (!els.requestYearFilter) return;
  const years = [...new Set((requestState.selectedClient?.documents || []).map((doc) => doc.taxYear).filter(Boolean))].sort((a, b) => String(b).localeCompare(String(a)));
  const currentYear = String(new Date().getFullYear());
  if (!years.includes(currentYear)) years.unshift(currentYear);
  els.requestYearFilter.innerHTML = `<option value="all">All years</option>${years.map((year) => `<option value="${escapeHtml(year)}">${escapeHtml(year)}</option>`).join("")}`;
}

function updateRequestSteps() {
  const hasClient = !!(requestState.selectedClientId && requestClientEmail(requestState.selectedClient));
  const hasFiles = requestState.selectedFiles.length > 0;
  els.requestClientCheck.hidden = !hasClient;
  els.requestFilesCheck.hidden = !hasFiles;
  els.requestStepClient?.classList.toggle("complete", hasClient);
  els.requestStepFiles?.classList.toggle("locked", !hasClient);
  els.requestStepFiles?.classList.toggle("active", hasClient && !hasFiles);
  els.requestStepFiles?.classList.toggle("complete", hasFiles);
  els.requestStepSend?.classList.toggle("locked", !hasFiles);
  els.requestStepSend?.classList.toggle("active", hasFiles);
}

async function searchClientFiles() {
  if (!requestState.selectedClientId) return;
  const query = (els.requestSearchInput?.value || "").trim();
  const typeFilter = els.requestTypeFilter?.value || "all";
  const yearFilter = els.requestYearFilter?.value || "all";
  const sources = [];
  if (els.requestSourceDb?.checked) sources.push("database");
  if (els.requestSourceDrive?.checked) sources.push("drive");
  if (!sources.length) {
    showToast("Select at least one source to search.", "warning");
    return;
  }
  if (els.requestResultsList) els.requestResultsList.innerHTML = `<div class="database-empty">Searching files...</div>`;
  try {
    const response = await fetch(`${API_BASE_URL}/api/requests/search-files`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId: requestState.selectedClientId,
        query,
        sources,
        fileTypes: typeFilter === "all" ? ["all"] : [typeFilter],
        taxYear: yearFilter === "all" ? null : yearFilter,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Search failed");
    requestState.searchResults = data.results || [];
    renderRequestResults(requestState.searchResults);
  } catch (error) {
    if (els.requestResultsList) els.requestResultsList.innerHTML = `<div class="database-empty">Search failed: ${escapeHtml(error.message)}</div>`;
  }
}

function applyQuickFilter(filterType, button) {
  const currentYear = String(new Date().getFullYear());
  const priorYear = String(new Date().getFullYear() - 1);
  const presets = {
    "latest-return": { query: "return", year: currentYear },
    "w2": { query: "W2 W-2 wage", year: "all" },
    "prior-return": { query: "return", year: priorYear },
    "tax-docs": { query: "", year: "all" },
    "all": { query: "", year: "all" },
  };
  const preset = presets[filterType] || presets.all;
  if (els.requestSearchInput) els.requestSearchInput.value = preset.query;
  if (els.requestYearFilter) els.requestYearFilter.value = preset.year;
  document.querySelectorAll("[data-request-filter]").forEach((item) => item.classList.toggle("active", item === button));
  searchClientFiles();
}

function renderRequestResults(results = []) {
  if (!els.requestResultsList) return;
  if (!results.length) {
    const query = (els.requestSearchInput?.value || "").trim();
    els.requestResultsList.innerHTML = `<div class="database-empty">No files found${query ? ` matching "${escapeHtml(query)}"` : ""}. Try a different search term or browse all files.</div>`;
    if (els.requestSelectAllVisible) els.requestSelectAllVisible.checked = false;
    return;
  }
  const selectedIds = new Set(requestState.selectedFiles.map((file) => file.id));
  els.requestResultsList.innerHTML = results.map((file) => {
    const selected = selectedIds.has(file.id);
    const ext = fileExtension(file.name || "file").toLowerCase();
    const sourceLabel = file.source === "database" && file.hasDriveCopy ? "DB + Drive" : file.source === "database" ? "DB" : "Drive";
    return `
      <label class="request-result-item ${selected ? "selected" : ""}">
        <input type="checkbox" ${selected ? "checked" : ""} data-request-file="${escapeHtml(file.id)}" />
        <span class="request-result-icon">${requestFileIcon(file.name, file.mimeType)}</span>
        <span class="request-result-info">
          <span class="request-result-name">${escapeHtml(file.name || "Unnamed file")}</span>
          <span class="request-result-desc">${escapeHtml(file.description || file.category || "Document")}${file.addedAt ? ` - Added ${escapeHtml(String(file.addedAt).slice(0, 10))}` : ""}${file.modifiedTime ? ` - Modified ${escapeHtml(String(file.modifiedTime).slice(0, 10))}` : ""}</span>
          <span class="request-result-badges">
            ${file.taxYear ? `<span class="badge badge-year">${escapeHtml(file.taxYear)}</span>` : ""}
            <span class="badge badge-${ext.includes("xls") ? "excel" : ext.includes("pdf") ? "pdf" : "year"}">${escapeHtml(ext.toUpperCase())}</span>
            <span class="badge ${sourceLabel === "DB + Drive" ? "badge-both" : sourceLabel === "Drive" ? "badge-drive" : "badge-db"}">${sourceLabel}</span>
            ${file.driveWebViewLink ? `<a href="${escapeHtml(file.driveWebViewLink)}" target="_blank">View in Drive</a>` : ""}
          </span>
        </span>
      </label>`;
  }).join("");
  els.requestResultsList.querySelectorAll("[data-request-file]").forEach((input) => input.addEventListener("change", () => toggleFileSelection(input.dataset.requestFile)));
  if (els.requestSelectAllVisible) els.requestSelectAllVisible.checked = results.every((file) => selectedIds.has(file.id));
}

function requestFileIcon(name = "", mimeType = "") {
  const text = `${name} ${mimeType}`.toLowerCase();
  if (text.includes("pdf")) return "PDF";
  if (text.includes("xls") || text.includes("spreadsheet") || text.includes("csv")) return "XLS";
  if (text.includes("doc") || text.includes("word")) return "DOC";
  return "FILE";
}

function toggleFileSelection(fileId) {
  const file = requestState.searchResults.find((item) => item.id === fileId);
  if (!file) return;
  const index = requestState.selectedFiles.findIndex((item) => item.id === fileId);
  if (index >= 0) requestState.selectedFiles.splice(index, 1);
  else requestState.selectedFiles.push(file);
  renderRequestResults(requestState.searchResults);
  renderSelectedFilesPanel();
  updateRequestSteps();
}

function toggleRequestSelectAll(checked) {
  if (checked) {
    const selectedIds = new Set(requestState.selectedFiles.map((file) => file.id));
    requestState.searchResults.forEach((file) => {
      if (!selectedIds.has(file.id)) requestState.selectedFiles.push(file);
    });
  } else {
    const visibleIds = new Set(requestState.searchResults.map((file) => file.id));
    requestState.selectedFiles = requestState.selectedFiles.filter((file) => !visibleIds.has(file.id));
  }
  renderRequestResults(requestState.searchResults);
  renderSelectedFilesPanel();
  updateRequestSteps();
}

function renderSelectedFilesPanel() {
  if (!els.requestSelectedPanel) return;
  const totalSize = requestState.selectedFiles.reduce((sum, file) => sum + Number(file.size || 0), 0);
  els.requestSelectedPanel.innerHTML = `
    <div class="selected-files-title">Selected Files (${requestState.selectedFiles.length})</div>
    ${requestState.selectedFiles.length ? requestState.selectedFiles.map((file) => `
      <div class="selected-file-row">
        <span>${requestFileIcon(file.name, file.mimeType)}</span>
        <span>${escapeHtml(file.name || "Unnamed file")}</span>
        <button class="selected-file-remove" type="button" data-remove-request-file="${escapeHtml(file.id)}">x</button>
      </div>`).join("") : `<div class="database-empty">No files selected.</div>`}
    <div class="selected-files-total ${totalSize > 20 * 1024 * 1024 ? "size-warning" : ""}">Total: ${formatBytes(totalSize)}${totalSize > 20 * 1024 * 1024 ? " - Gmail may reject emails over 25MB." : ""}</div>
    ${requestState.selectedFiles.length ? `<button class="text-button" type="button" id="requestClearSelected">Clear all</button>` : ""}`;
  els.requestSelectedPanel.querySelectorAll("[data-remove-request-file]").forEach((button) => button.addEventListener("click", () => toggleFileSelection(button.dataset.removeRequestFile)));
  els.requestSelectedPanel.querySelector("#requestClearSelected")?.addEventListener("click", () => {
    requestState.selectedFiles = [];
    renderRequestResults(requestState.searchResults);
    renderSelectedFilesPanel();
    updateRequestSteps();
  });
}

function requestPreparerDefaults() {
  try {
    const defaults = JSON.parse(localStorage.getItem("taxapp_firm_defaults") || "{}");
    return {
      name: defaults.preparerName || currentUsername || "",
      firmName: defaults.firmName || "",
      email: defaults.firmEmail || deliverableState.gmailStatus?.email || "",
      phone: defaults.firmPhone || "",
    };
  } catch (_) {
    return { name: currentUsername || "", firmName: "", email: deliverableState.gmailStatus?.email || "", phone: "" };
  }
}

async function generateRequestEmail() {
  const client = requestState.selectedClient;
  if (!client || !requestState.selectedFiles.length) return;
  const button = els.generateRequestEmail;
  button.disabled = true;
  button.textContent = "Generating...";
  try {
    const response = await runWithCostEstimate("deliverable", { returnType: client.returnType || "" }, () => fetch(`${API_BASE_URL}/api/requests/generate-email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client: { name: client.name || "", email: requestClientEmail(client), company: client.company || client.name || "" },
        preparer: requestPreparerDefaults(),
        files: requestState.selectedFiles.map((file) => ({ name: file.name, category: file.category, taxYear: file.taxYear, description: file.description })),
        requestContext: els.requestContextInput?.value.trim() || "",
        tone: document.querySelector("input[name='requestTone']:checked")?.value || "friendly",
      }),
    }));
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Email generation failed");
    requestState.generatedEmail = data;
    renderRequestEmailPreview(data);
  } catch (error) {
    showToast(`Email generation failed: ${error.message}`, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Generate Email";
  }
}

function renderRequestEmailPreview(email) {
  if (!els.requestEmailPreview) return;
  if (!email) {
    els.requestEmailPreview.innerHTML = "";
    return;
  }
  const clientEmail = requestClientEmail(requestState.selectedClient);
  const gmail = deliverableState.gmailStatus || {};
  els.requestEmailPreview.innerHTML = `
    <div class="email-preview-card">
      <div class="email-preview-header">
        <label class="email-header-row"><span class="email-header-label">Subject</span><input id="requestEmailSubject" class="email-header-input" value="${escapeHtml(email.subject || "")}" /></label>
        <label class="email-header-row"><span class="email-header-label">To</span><input id="requestEmailTo" class="email-header-input" value="${escapeHtml(clientEmail)}" /></label>
        <label class="email-header-row"><span class="email-header-label">CC</span><input id="requestEmailCc" class="email-header-input" placeholder="Optional CC" /></label>
        <label class="database-check"><input id="requestCcSelf" type="checkbox" checked /> CC myself</label>
      </div>
      <div class="email-preview-body"><textarea id="requestEmailBody" class="email-body-textarea">${escapeHtml(email.body || "")}</textarea></div>
      <div class="email-attachments-section">
        <div class="email-attachments-title">Attachments</div>
        ${requestState.selectedFiles.map((file) => `<div class="email-attachment-item">${requestFileIcon(file.name, file.mimeType)} ${escapeHtml(file.name || "")} ${file.size ? `(${formatBytes(Number(file.size))})` : ""}</div>`).join("")}
      </div>
    </div>
    <div class="action-row">
      <button class="secondary-button" type="button" id="requestRegenerate">Regenerate</button>
      <button class="secondary-button" type="button" id="requestCopyEmail">Copy Email</button>
      <button class="secondary-button" type="button" id="requestOpenGmail">Open in Gmail</button>
    </div>
    ${gmail.authorized ? `
      <div class="gmail-send-section">
        <div class="gmail-send-section-title">Send via Gmail</div>
        <p>From: ${escapeHtml(gmail.email || "Authorized Gmail account")}</p>
        <button id="sendRequestButton" class="btn-send-gmail" type="button">Send via Gmail</button>
      </div>` : `
      <div class="gmail-not-connected">Gmail is not connected. You can copy the email or open Gmail and attach files manually.</div>
      <button class="secondary-button" type="button" onclick="connectGoogleDrive()">Connect Gmail</button>`}`;
  document.getElementById("requestRegenerate")?.addEventListener("click", generateRequestEmail);
  document.getElementById("requestCopyEmail")?.addEventListener("click", () => copyText(`${document.getElementById("requestEmailSubject")?.value || ""}\n\n${document.getElementById("requestEmailBody")?.value || ""}`));
  document.getElementById("requestOpenGmail")?.addEventListener("click", openRequestMailto);
  document.getElementById("sendRequestButton")?.addEventListener("click", sendRequestEmail);
}

function openRequestMailto() {
  const to = document.getElementById("requestEmailTo")?.value || "";
  const subject = document.getElementById("requestEmailSubject")?.value || "";
  const body = `${document.getElementById("requestEmailBody")?.value || ""}\n\nNote: attachments must be added manually in Gmail.`;
  window.open(`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, "_blank");
}

async function sendRequestEmail() {
  if (!requestState.generatedEmail || requestState.isSending) return;
  requestState.isSending = true;
  const button = document.getElementById("sendRequestButton");
  button.disabled = true;
  try {
    button.textContent = "Reading files...";
    const readResponse = await fetch(`${API_BASE_URL}/api/requests/read-files`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId: requestState.selectedClientId,
        files: requestState.selectedFiles.map((file) => ({ id: file.id, source: file.source, driveFileId: file.driveFileId, name: file.name, mimeType: file.mimeType })),
      }),
    });
    const readData = await readResponse.json();
    if (!readResponse.ok) throw new Error(readData.error || "Could not read selected files");
    if (readData.errors?.length) showToast(`${readData.errors.length} file(s) could not be read.`, "warning");

    button.textContent = "Sending...";
    const subject = document.getElementById("requestEmailSubject")?.value || "";
    const bodyText = document.getElementById("requestEmailBody")?.value || "";
    const to = document.getElementById("requestEmailTo")?.value || "";
    const sendResponse = await fetch(`${API_BASE_URL}/api/deliverable/send-gmail`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to,
        subject,
        bodyHtml: plainTextEmailToHtml(bodyText),
        bodyText,
        attachments: readData.files || [],
        ccPreparer: !!document.getElementById("requestCcSelf")?.checked,
        preparerEmail: requestPreparerDefaults().email || deliverableState.gmailStatus?.email || "",
        cc: document.getElementById("requestEmailCc")?.value || null,
      }),
    });
    const sendData = await sendResponse.json();
    if (!sendResponse.ok || !sendData.ok) throw new Error(sendData.error || "Send failed");
    await fetch(`${API_BASE_URL}/api/requests/log`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId: requestState.selectedClientId,
        requestDescription: els.requestContextInput?.value || "",
        filesSent: requestState.selectedFiles.map((file) => ({ name: file.name, taxYear: file.taxYear })),
        sentAt: new Date().toISOString(),
        sentTo: to,
        gmailMessageId: sendData.messageId,
      }),
    });
    renderRequestSendSuccess({ to, messageId: sendData.messageId });
    showToast("Email sent successfully", "success");
    await loadDatabaseClients();
  } catch (error) {
    showToast(`Failed to send: ${error.message}`, "error");
    button.disabled = false;
    button.textContent = "Send via Gmail";
  } finally {
    requestState.isSending = false;
  }
}

function renderRequestSendSuccess({ to, messageId }) {
  if (!els.requestSendSuccess) return;
  els.requestSendSuccess.innerHTML = `
    <div class="send-success-card">
      <div class="send-success-title">Email sent successfully</div>
      <div class="send-success-meta">To: ${escapeHtml(to)} | Message ID: ${escapeHtml(messageId || "n/a")}</div>
      <div class="send-success-actions"><button class="secondary-button" type="button" id="requestSendAnother">Send Another Request</button></div>
    </div>`;
  document.getElementById("requestSendAnother")?.addEventListener("click", resetRequestFlow);
}

function resetRequestFlow() {
  requestState.searchResults = [];
  requestState.selectedFiles = [];
  requestState.generatedEmail = null;
  if (els.requestSearchInput) els.requestSearchInput.value = "";
  if (els.requestContextInput) els.requestContextInput.value = "";
  renderRequestResults([]);
  renderSelectedFilesPanel();
  renderRequestEmailPreview(null);
  if (els.requestSendSuccess) els.requestSendSuccess.innerHTML = "";
  updateRequestSteps();
}

function renderRequestHistory() {
  if (!els.requestHistoryList) return;
  const client = requestState.selectedClient;
  const items = (client?.communicationLog || []).filter((item) => item.type === "email" && String(item.summary || "").startsWith("Sent ")).slice(-5).reverse();
  els.requestHistoryList.innerHTML = items.length ? items.map((item) => `
    <div class="request-history-item">
      <span class="request-history-date">${escapeHtml(String(item.date || item.addedAt || "").slice(0, 10))}</span>
      <span class="request-history-files">${escapeHtml(item.summary || "")}</span>
      <span>${escapeHtml(item.sentTo || "")}</span>
    </div>`).join("") : `<div class="database-empty">No recent client requests.</div>`;
}

function renderDatabaseClientDetail() {
  const client = selectedDatabaseClient();
  if (!els.databaseClientDetail) return;
  document.querySelectorAll("[data-client-tab]").forEach((button) => button.classList.toggle("active", button.dataset.clientTab === databaseState.activeClientTab));
  if (!client) {
    els.databaseClientTitle.textContent = "Client Detail";
    els.databaseClientSubtitle.textContent = "Select a client to manage AI context.";
    els.databaseClientDetail.innerHTML = `<div class="database-detail-empty">Select a client from the list.</div>`;
    return;
  }
  els.databaseClientTitle.textContent = client.name || "Unnamed client";
  els.databaseClientSubtitle.textContent = `${client.returnType || "No return type"}${client.ein ? ` - EIN ${client.ein}` : ""}`;
  if (databaseState.activeClientTab === "documents") els.databaseClientDetail.innerHTML = renderClientDocuments(client);
  else if (databaseState.activeClientTab === "activity") els.databaseClientDetail.innerHTML = renderClientActivity(client);
  else if (databaseState.activeClientTab === "notes") els.databaseClientDetail.innerHTML = `<h4>Notes</h4><p>${escapeHtml(client.notes || "No notes saved.")}</p>`;
  else els.databaseClientDetail.innerHTML = renderClientProfileContext(client);
  bindDatabaseClientActions(client);
}

function renderClientProfileContext(client) {
  const software = softwareById(client.taxSoftware?.primary || readFirmDefaults().defaultTaxSoftware || "proconnect");
  const is1040Client = (client.returnType || client.entityType || "").includes("1040");
  return `
    <div class="database-section-block">
      <h4>${is1040Client ? "SSN / EIN" : "EIN"}</h4>
      <p>${is1040Client
        ? "SSN del contribuyente principal."
        : "Employer Identification Number para este cliente."}</p>
      <div class="database-inline-form" style="align-items:center;">
        <input id="databaseClientEin" type="text"
          placeholder="${is1040Client ? "Ex. 123-45-6789" : "Ex. 12-3456789"}"
          value="${escapeHtml(client.ein || "")}"
          style="max-width:200px;" />
        <button id="databaseSaveClientEin" class="primary-button small-button" type="button">Guardar</button>
      </div>
    </div>
    <div class="database-section-block">
      <h4>Tax Software</h4>
      <p>Saved software preference used by Preparation guidance for this client.</p>
      <div class="software-client-row">
        <span class="software-active-badge"><strong>${escapeHtml(software?.logo || "")} ${escapeHtml(software?.name || "Not set")}</strong></span>
        <button id="databaseUseCurrentSoftware" class="ghost-button small-button" type="button">Set to current Preparation selection</button>
      </div>
    </div>
    <div class="database-section-block">
      <h4>Permanent Instructions</h4>
      <p>These are injected into every AI call for this client.</p>
      <div class="database-inline-form">
        <select id="databaseInstructionCategory"><option value="accounting">Accounting</option><option value="tax_treatment">Tax Treatment</option><option value="officer_info">Officer Info</option><option value="related_party">Related Party</option><option value="audit_flag">Audit Flag</option><option value="preference">Preference</option><option value="other">Other</option></select>
        <textarea id="databaseInstructionText" rows="2" placeholder="Add a permanent instruction for this client."></textarea>
        <button id="databaseAddInstruction" class="primary-button small-button" type="button">Add Instruction</button>
      </div>
      <div class="database-chip-list">${(client.permanentInstructions || []).map((item) => `<span class="database-chip ${item.active === false ? "muted" : ""}">${escapeHtml(item.category || "other")}: ${escapeHtml(item.text || "")} <button type="button" data-delete-instruction="${escapeHtml(item.id)}">x</button></span>`).join("") || "<em>No permanent instructions.</em>"}</div>
    </div>
    <div class="database-section-block">
      <h4>Related Parties</h4>
      <div class="database-inline-form">
        <input id="databaseRelatedName" type="text" placeholder="Name" />
        <input id="databaseRelatedRelationship" type="text" placeholder="Relationship" />
        <input id="databaseRelatedEin" type="text" placeholder="EIN optional" />
        <input id="databaseRelatedNotes" type="text" placeholder="Notes" />
        <button id="databaseAddRelatedParty" class="primary-button small-button" type="button">Add</button>
      </div>
      <div class="database-list compact">${(client.relatedParties || []).map((item) => `<div class="database-row"><strong>${escapeHtml(item.name || "")}</strong><span>${escapeHtml(item.relationship || "")}${item.ein ? ` - ${escapeHtml(item.ein)}` : ""}</span><button type="button" data-delete-related="${escapeHtml(item.id)}">Delete</button></div>`).join("") || "<em>No related parties.</em>"}</div>
    </div>`;
}

function renderClientDocuments(client) {
  return `
    <div class="database-section-block">
      <h4>Documents</h4>
      <div class="database-inline-form">
        <input id="databaseDocumentName" type="text" placeholder="Document name" />
        <select id="databaseDocumentCategory"><option value="prior_return">Prior Return</option><option value="workpaper">Workpaper</option><option value="notice">Notice</option><option value="correspondence">Correspondence</option><option value="other">Other</option></select>
        <input id="databaseDocumentYear" type="text" placeholder="Tax year" />
        <textarea id="databaseDocumentDescription" rows="2" placeholder="Description"></textarea>
        <button id="databaseAddDocument" class="primary-button small-button" type="button">Add Document Note</button>
      </div>
      <div class="database-list compact">${(client.documents || []).map((doc) => `<div class="database-row"><strong>${escapeHtml(doc.name || "")}</strong><span>${escapeHtml(doc.category || "other")} ${doc.taxYear ? `- TY${escapeHtml(doc.taxYear)}` : ""}</span>${doc.driveWebViewLink ? `<a href="${escapeHtml(doc.driveWebViewLink)}" target="_blank">Drive</a>` : ""}<button type="button" data-delete-document="${escapeHtml(doc.id)}">Delete</button></div>`).join("") || "<em>No documents saved.</em>"}</div>
    </div>`;
}

function renderClientActivity(client) {
  return `
    <div class="database-section-block">
      <h4>Communication Log</h4>
      <div class="database-inline-form">
        <input id="databaseActivityDate" type="date" value="${new Date().toISOString().slice(0, 10)}" />
        <select id="databaseActivityType"><option value="note">Note</option><option value="call">Call</option><option value="email">Email</option><option value="meeting">Meeting</option></select>
        <textarea id="databaseActivitySummary" rows="2" placeholder="Summary"></textarea>
        <button id="databaseAddActivity" class="primary-button small-button" type="button">Add Note</button>
      </div>
      <div class="database-list compact">${(client.communicationLog || []).map((item) => `<div class="database-row"><strong>${escapeHtml((item.date || "").slice(0, 10))}</strong><span>${escapeHtml(item.type || "note")} - ${escapeHtml(item.summary || "")}</span></div>`).join("") || "<em>No activity recorded.</em>"}</div>
    </div>`;
}

function bindDatabaseClientActions(client) {
  document.getElementById("databaseSaveClientEin")?.addEventListener("click", async () => {
    const ein = (document.getElementById("databaseClientEin")?.value || "").trim();
    // Spread full client to avoid pickClientFields zeroing out other fields
    await fetch(`${API_BASE_URL}/api/clients/${client.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...client, ein }),
    });
    await loadDatabaseClients();
    renderDatabaseClientDetail();
    showToast("SSN/EIN guardado.", "success");
  });
  document.getElementById("databaseUseCurrentSoftware")?.addEventListener("click", async () => {
    const software = softwareById(prepState.taxSoftware || "proconnect");
    await fetch(`${API_BASE_URL}/api/clients/${client.id}/tax-software`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ primary: software.id, version: document.getElementById("prepCurrentYear")?.value || "", customNotes: "" }),
    });
    await loadDatabaseClients();
    renderDatabaseClientDetail();
  });
  document.getElementById("databaseAddInstruction")?.addEventListener("click", async () => {
    const payload = { category: document.getElementById("databaseInstructionCategory").value, text: document.getElementById("databaseInstructionText").value, addedBy: currentUsername || "local user" };
    if (!payload.text.trim()) return;
    await fetch(`${API_BASE_URL}/api/clients/${client.id}/instructions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    await loadDatabaseClients(); renderDatabaseClientDetail();
  });
  document.getElementById("databaseAddRelatedParty")?.addEventListener("click", async () => {
    const payload = { name: document.getElementById("databaseRelatedName").value, relationship: document.getElementById("databaseRelatedRelationship").value, ein: document.getElementById("databaseRelatedEin").value, notes: document.getElementById("databaseRelatedNotes").value };
    if (!payload.name.trim()) return;
    await fetch(`${API_BASE_URL}/api/clients/${client.id}/related-parties`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    await loadDatabaseClients(); renderDatabaseClientDetail();
  });
  document.getElementById("databaseAddDocument")?.addEventListener("click", async () => {
    const payload = { name: document.getElementById("databaseDocumentName").value || "Document", category: document.getElementById("databaseDocumentCategory").value, taxYear: document.getElementById("databaseDocumentYear").value, description: document.getElementById("databaseDocumentDescription").value };
    await fetch(`${API_BASE_URL}/api/clients/${client.id}/documents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    await loadDatabaseClients(); renderDatabaseClientDetail();
  });
  document.getElementById("databaseAddActivity")?.addEventListener("click", async () => {
    const payload = { date: document.getElementById("databaseActivityDate").value, type: document.getElementById("databaseActivityType").value, summary: document.getElementById("databaseActivitySummary").value, addedBy: currentUsername || "local user" };
    if (!payload.summary.trim()) return;
    await fetch(`${API_BASE_URL}/api/clients/${client.id}/communication-log`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    await loadDatabaseClients(); renderDatabaseClientDetail();
  });
  els.databaseClientDetail.querySelectorAll("[data-delete-instruction]").forEach((button) => button.addEventListener("click", async () => { await fetch(`${API_BASE_URL}/api/clients/${client.id}/instructions/${button.dataset.deleteInstruction}`, { method: "DELETE" }); await loadDatabaseClients(); renderDatabaseClientDetail(); }));
  els.databaseClientDetail.querySelectorAll("[data-delete-related]").forEach((button) => button.addEventListener("click", async () => { await fetch(`${API_BASE_URL}/api/clients/${client.id}/related-parties/${button.dataset.deleteRelated}`, { method: "DELETE" }); await loadDatabaseClients(); renderDatabaseClientDetail(); }));
  els.databaseClientDetail.querySelectorAll("[data-delete-document]").forEach((button) => button.addEventListener("click", async () => { await fetch(`${API_BASE_URL}/api/clients/${client.id}/documents/${button.dataset.deleteDocument}`, { method: "DELETE" }); await loadDatabaseClients(); renderDatabaseClientDetail(); }));
}

async function loadDatabaseLibrary() {
  const library = await fetch(`${API_BASE_URL}/api/library`).then((res) => res.json()).catch(() => ({ documents: [], globalInstructions: "" }));
  databaseState.library = library;
  if (els.databaseGlobalInstructions && els.databaseGlobalInstructions.value !== library.globalInstructions) els.databaseGlobalInstructions.value = library.globalInstructions || "";
  if (els.databaseGlobalTokenEstimate) els.databaseGlobalTokenEstimate.textContent = "";
  if (library.defaultTaxSoftware) {
    const defaults = readFirmDefaults();
    if (!defaults.defaultTaxSoftware) {
      defaults.defaultTaxSoftware = library.defaultTaxSoftware;
      writeFirmDefaults(defaults);
    }
    setFirmSoftwareSelection(defaults.defaultTaxSoftware || library.defaultTaxSoftware);
  }
  renderDatabaseLibrary();
}

function renderDatabaseLibrary() {
  if (!els.databaseLibraryList) return;
  const docs = databaseState.library.documents || [];
  els.databaseLibraryList.innerHTML = docs.length ? docs.map((doc) => `<article class="database-list-card"><strong>${escapeHtml(doc.title || "Untitled")}</strong><span>${escapeHtml(doc.category || "reference")} - applies to ${(doc.applicableTo || ["all"]).map(escapeHtml).join(", ")}${doc.alwaysInject ? " - Always inject" : ""}</span><p>${escapeHtml((doc.content || "").slice(0, 180) || "File-based library item.")}</p></article>`).join("") : `<div class="database-empty">No firm library documents yet.</div>`;
}

async function saveDatabaseGlobalInstructions() {
  await fetch(`${API_BASE_URL}/api/library/global-instructions`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ globalInstructions: els.databaseGlobalInstructions?.value || "" }) });
  els.databaseGlobalSaveStatus.textContent = "Saved just now";
  await loadDatabaseLibrary();
}

async function addDatabaseLibraryItem() {
  const payload = { title: els.databaseLibraryTitle.value, category: els.databaseLibraryCategory.value, applicableTo: (els.databaseLibraryAppliesTo.value || "all").split(",").map((item) => item.trim()).filter(Boolean), alwaysInject: els.databaseLibraryAlwaysInject.checked, content: els.databaseLibraryContent.value, addedBy: currentUsername || "local user" };
  if (!payload.title.trim() || !payload.content.trim()) return showToast("Add a title and content before saving.", "warning");
  await fetch(`${API_BASE_URL}/api/library`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  els.databaseLibraryTitle.value = ""; els.databaseLibraryContent.value = "";
  await loadDatabaseLibrary();
}

async function loadDatabaseDeadlines() {
  const data = await fetch(`${API_BASE_URL}/api/deadlines`).then((res) => res.json()).catch(() => ({ upcoming: [] }));
  databaseState.deadlines = data.upcoming || [];
  renderDatabaseDeadlines();
}

function renderDatabaseDeadlines() {
  if (!els.databaseDeadlineList) return;
  els.databaseDeadlineList.innerHTML = databaseState.deadlines.length ? databaseState.deadlines.map((item) => `<article class="deadline-card urgency-${deadlineUrgency(item.daysUntil)}"><strong>${escapeHtml(item.daysUntil)} days - ${escapeHtml(item.deadlineLabel || "Deadline")}</strong><p>${escapeHtml(item.clientName || "")} - ${escapeHtml(item.returnType || "")} TY${escapeHtml(item.taxYear || "")}</p><span>Due ${escapeHtml((item.dueDate || "").slice(0, 10))}</span></article>`).join("") : `<div class="database-empty">No upcoming deadlines indexed.</div>`;
}

function deadlineUrgency(days) {
  if (days <= 15) return "red";
  if (days <= 30) return "orange";
  if (days <= 60) return "amber";
  if (days <= 90) return "blue";
  return "gray";
}

async function rebuildDatabaseDeadlines() {
  const data = await fetch(`${API_BASE_URL}/api/deadlines/rebuild`, { method: "POST" }).then((res) => res.json());
  databaseState.deadlines = data.upcoming || [];
  renderDatabaseDeadlines();
}

async function loadDatabaseLearning() {
  const learning = await fetch(`${API_BASE_URL}/api/learning`).then((res) => res.json()).catch(() => ({ globalCorrections: [], clientCorrections: {} }));
  databaseState.learning = learning;
  if (els.organizerQuestionCount) els.organizerQuestionCount.textContent = (learning.globalCorrections || []).filter((item) => item.active !== false).length;
  renderDatabaseLearning();
}

function renderDatabaseLearning() {
  if (!els.databaseLearningList) return;
  const global = databaseState.learning.globalCorrections || [];
  const clientCount = Object.values(databaseState.learning.clientCorrections || {}).reduce((sum, list) => sum + (list || []).length, 0);
  els.databaseLearningStats.textContent = `Total corrections: ${global.length + clientCount} | Active: ${global.filter((item) => item.active !== false).length + clientCount}`;
  els.databaseLearningList.innerHTML = global.length ? global.map((item) => `<article class="database-list-card ${item.active === false ? "muted" : ""}"><strong>${(item.appliesTo || ["all"]).map(escapeHtml).join(", ")}</strong><p>${escapeHtml(item.correction || "")}</p><span>Source: ${escapeHtml(item.source || "manual")} - Used ${Number(item.usageCount || 0)} times</span></article>`).join("") : `<div class="database-empty">No global corrections yet.</div>`;
}

async function addDatabaseLearning() {
  const payload = { correction: els.databaseLearningCorrection.value, appliesTo: (els.databaseLearningAppliesTo.value || "all").split(",").map((item) => item.trim()).filter(Boolean), confidence: els.databaseLearningConfidence.value };
  if (!payload.correction.trim()) return;
  await fetch(`${API_BASE_URL}/api/learning/global`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  els.databaseLearningCorrection.value = "";
  await loadDatabaseLearning();
}

async function loadDatabaseFeedback() {
  const feedback = await fetch(`${API_BASE_URL}/api/feedback`).then((res) => res.json()).catch(() => ({ entries: [] }));
  databaseState.feedback = feedback;
  renderDatabaseFeedback();
}

function renderDatabaseFeedback() {
  if (!els.databaseFeedbackList) return;
  const entries = databaseState.feedback.entries || [];
  const learned = entries.filter((item) => item.addedToLearning).length;
  els.databaseFeedbackStats.textContent = `Total feedback: ${entries.length} | Added to learning: ${learned}`;
  els.databaseFeedbackList.innerHTML = entries.length ? entries.slice().reverse().map((item) => `<article class="database-list-card"><strong>${escapeHtml(item.tab || "general")} - ${escapeHtml(item.feedbackType || "feedback")}</strong><p>${escapeHtml(item.preparerCorrection || item.originalAIOutput || "")}</p><span>${escapeHtml((item.addedAt || "").slice(0, 10))} - ${item.addedToLearning ? "Learned" : "Pending"}</span></article>`).join("") : `<div class="database-empty">No feedback yet.</div>`;
}

async function submitDatabaseFeedback() {
  const payload = { tab: els.databaseFeedbackTab.value, feedbackType: els.databaseFeedbackType.value, rating: els.databaseFeedbackRating.value, preparerCorrection: els.databaseFeedbackCorrection.value, learnFromThis: els.databaseFeedbackLearn.checked };
  if (!payload.preparerCorrection.trim()) return;
  await fetch(`${API_BASE_URL}/api/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  els.databaseFeedbackCorrection.value = "";
  await Promise.all([loadDatabaseFeedback(), loadDatabaseLearning()]);
}

function renderOrganizerFiles() {
  const file = organizerFiles.priorYearReturn;
  els.organizerPriorCount.textContent = file ? 1 : 0;
  els.organizerPriorInlineCount.textContent = file ? 1 : 0;
  renderNoticeFileList(els.organizerPriorList, file, "No prior-year return uploaded.");
}

function validateOrganizerInputs() {
  const messages = [];
  if (!organizerFiles.priorYearReturn) messages.push({ blocks: true, text: "Upload a prior-year return before generating the organizer." });
  if (!els.organizerClientName.value.trim()) messages.push({ blocks: true, text: "Enter a client name." });
  if (!els.organizerReturnType.value) messages.push({ blocks: true, text: "Select a return type." });
  if (!els.organizerTaxYear.value.trim()) messages.push({ blocks: true, text: "Enter the tax year being organized." });
  return messages;
}

function renderOrganizerValidation(messages) {
  els.organizerValidationMessages.innerHTML = messages.map((item) => `<div class="${item.blocks ? "error" : "warning"}">${escapeHtml(item.text)}</div>`).join("");
}

async function runOrganizer(sectionName = "") {
  const messages = validateOrganizerInputs();
  renderOrganizerValidation(messages);
  if (messages.some((item) => item.blocks)) return;

  els.organizerStatus.textContent = "Running";
  els.generateOrganizer.disabled = true;
  els.organizerRunHint.textContent = sectionName ? `Regenerating ${sectionName}...` : "Preparing prior-year return...";
  els.organizerResults.innerHTML = `<article><span class="tag neutral">Running</span><h3>Generating organizer</h3><p>Claude is reading the prior-year return and building personalized questions.</p></article>`;

  try {
    const payload = await buildOrganizerPayload(sectionName);
    els.organizerRunHint.textContent = "Sending organizer request to backend...";
    const response = await runWithCostEstimate("organizer", {
      returnType: payload.returnType || payload.metadata?.returnType || "",
      hasWorkpaper: true,
    }, () => fetch(`${API_BASE_URL}/api/organizer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }));
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Backend returned ${response.status}`);
    const organizer = result.organizer || {};
    if (sectionName && lastOrganizerOutput?.organizer) {
      mergeRegeneratedOrganizerSection(lastOrganizerOutput.organizer, organizer, sectionName);
      lastOrganizerOutput = { response: result, organizer: lastOrganizerOutput.organizer, payload };
    } else {
      lastOrganizerOutput = { response: result, organizer, payload };
    }
    organizerCurrentView = "preparer";
    renderOrganizerResult(lastOrganizerOutput.organizer, result);
    els.organizerStatus.textContent = "Complete";
    els.organizerExportActions.hidden = false;
    await autosaveSession({ organizerResult: lastOrganizerOutput.organizer });
  } catch (error) {
    els.organizerStatus.textContent = "Failed";
    renderOrganizerMessage("warning", "Organizer generation failed", error.message || "The backend could not complete the organizer.");
  } finally {
    els.generateOrganizer.disabled = false;
    els.organizerRunHint.textContent = "Claude will use the prior-year return to create a client-specific organizer.";
  }
}

async function buildOrganizerPayload(sectionName = "") {
  const prepared = await prepareOrganizerPriorReturn(organizerFiles.priorYearReturn);
  return {
    priorYearReturn: prepared,
    returnType: els.organizerReturnType.value,
    taxYear: els.organizerTaxYear.value.trim(),
    clientName: els.organizerClientName.value.trim(),
    entityType: els.organizerEntityType.value,
    additionalContext: [
      els.organizerAdditionalContext.value.trim(),
      sectionName ? `Regenerate only the section named "${sectionName}". Keep the same JSON schema and make that section improved and client-specific.` : "",
    ].filter(Boolean).join("\n\n"),
  };
}

async function prepareOrganizerPriorReturn(file) {
  const mediaType = file.type || guessMediaType(file.name);
  const ext = fileExtension(file.name).toLowerCase();
  if (mediaType === "application/pdf" || mediaType.startsWith("image/") || ["pdf", "png", "jpg", "jpeg"].includes(ext)) {
    return { name: displayFileName(file), type: mediaType || guessMediaType(file.name), encoding: "base64", content: await readAsBase64(file) };
  }
  const prepared = await prepareFileForReview({ file, type: "organizerPriorReturn" });
  return { name: prepared.name, type: prepared.mediaType || mediaType, encoding: prepared.encoding || "text", content: prepared.text || "Content could not be parsed from this file." };
}

function mergeRegeneratedOrganizerSection(existing, incoming, sectionName) {
  const replacement = (incoming.sections || []).find((section) => section.sectionName.toLowerCase() === sectionName.toLowerCase()) || (incoming.sections || [])[0];
  if (!replacement) return;
  const index = (existing.sections || []).findIndex((section) => section.sectionName.toLowerCase() === sectionName.toLowerCase());
  if (index >= 0) existing.sections[index] = replacement;
  else existing.sections.push(replacement);
}

function renderOrganizerResult(organizer, wrapper = {}) {
  const counts = countOrganizerPriorities(organizer);
  els.organizerQuestionCount.textContent = counts.total;
  setOrganizerViewButtons();
  els.organizerResults.innerHTML = `
    <article class="organizer-summary">
      <span class="tag success">Organizer</span>
      <h3>${escapeHtml(organizer.organizerTitle || "Personalized Tax Organizer")}</h3>
      <p>${escapeHtml(counts.required)} required items, ${escapeHtml(counts.recommended)} recommended items, ${escapeHtml(counts.optional)} optional items</p>
      ${renderOrganizerBanners(organizer)}
    </article>
    ${organizerCurrentView === "client" ? renderOrganizerClientView(organizer) : renderOrganizerPreparerView(organizer)}
    ${renderCostSummary(wrapper)}
  `;
  bindOrganizerActions(organizer);
}

function renderOrganizerBanners(organizer) {
  const carry = organizer.carryforwardItems || [];
  const special = organizer.specialAttentionItems || [];
  const deadlines = organizer.deadlineReminders || [];
  if (!carry.length && !special.length && !deadlines.length) return "";
  return `
    <div class="organizer-banner">
      ${special.length ? `<strong>Special attention</strong><ul>${special.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      ${carry.length ? `<strong>Carryforward items</strong><ul>${carry.map((item) => `<li>${escapeHtml(item.item)}${item.priorYearAmount ? ` - ${escapeHtml(item.priorYearAmount)}` : ""}${item.note ? `: ${escapeHtml(item.note)}` : ""}</li>`).join("")}</ul>` : ""}
      ${deadlines.length ? `<strong>Deadline reminders</strong><ul>${deadlines.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
    </div>`;
}

function renderOrganizerPreparerView(organizer) {
  return (organizer.sections || []).map((section, sectionIndex) => `
    <details class="organizer-section" open>
      <summary>${escapeHtml(section.sectionName)} <button class="ghost-button small-button regenerate-section" type="button" data-section="${escapeHtml(section.sectionName)}">Regenerate section</button></summary>
      <p>${escapeHtml(section.sectionDescription || "")}</p>
      <div class="organizer-table-wrap">
        <table class="organizer-table">
          <thead><tr><th>Question</th><th>Context</th><th>Document Required</th><th>PY Amount</th><th>Priority</th></tr></thead>
          <tbody>
            ${(section.questions || []).map((question, questionIndex) => `
              <tr>
                <td contenteditable="true" data-org-field="question" data-section="${sectionIndex}" data-question="${questionIndex}">${escapeHtml(question.question)}</td>
                <td contenteditable="true" data-org-field="context" data-section="${sectionIndex}" data-question="${questionIndex}">${escapeHtml(question.context)}</td>
                <td contenteditable="true" data-org-field="documentRequired" data-section="${sectionIndex}" data-question="${questionIndex}">${escapeHtml(question.documentRequired)}</td>
                <td contenteditable="true" data-org-field="priorYearAmount" data-section="${sectionIndex}" data-question="${questionIndex}">${escapeHtml(question.priorYearAmount || "")}</td>
                <td contenteditable="true" data-org-field="priority" data-section="${sectionIndex}" data-question="${questionIndex}">${escapeHtml(question.priority)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </details>`).join("");
}

function renderOrganizerClientView(organizer) {
  return (organizer.sections || []).map((section) => `
    <article class="organizer-client-section">
      <h3>${escapeHtml(section.sectionName)}</h3>
      <p>${escapeHtml(section.sectionDescription || "")}</p>
      <ol>
        ${(section.questions || []).map((question) => `
          <li>
            <label><input type="checkbox" /> ${escapeHtml(question.question)}</label>
            <small>Document needed: ${escapeHtml(question.documentRequired || "As applicable")}</small>
            <input type="text" placeholder="Client response" />
          </li>`).join("")}
      </ol>
    </article>`).join("");
}

function bindOrganizerActions(organizer) {
  document.querySelectorAll("[data-org-field]").forEach((node) => {
    node.addEventListener("input", () => syncOrganizerEdits(organizer));
  });
  document.querySelectorAll(".regenerate-section").forEach((button) => {
    button.addEventListener("click", () => runOrganizer(button.dataset.section || ""));
  });
}

function syncOrganizerEdits(organizer) {
  document.querySelectorAll("[data-org-field]").forEach((node) => {
    const section = organizer.sections[Number(node.dataset.section)];
    const question = section?.questions?.[Number(node.dataset.question)];
    if (!question) return;
    question[node.dataset.orgField] = node.textContent.trim();
  });
}

function setOrganizerView(view) {
  if (!lastOrganizerOutput?.organizer) return;
  syncOrganizerEdits(lastOrganizerOutput.organizer);
  organizerCurrentView = view;
  renderOrganizerResult(lastOrganizerOutput.organizer, lastOrganizerOutput.response);
}

function setOrganizerViewButtons() {
  els.organizerPreparerView.classList.toggle("active-view", organizerCurrentView === "preparer");
  els.organizerClientView.classList.toggle("active-view", organizerCurrentView === "client");
}

function countOrganizerPriorities(organizer) {
  const counts = { required: 0, recommended: 0, optional: 0, total: 0 };
  (organizer.sections || []).forEach((section) => {
    (section.questions || []).forEach((question) => {
      const priority = ["required", "recommended", "optional"].includes(question.priority) ? question.priority : "recommended";
      counts[priority] += 1;
      counts.total += 1;
    });
  });
  return counts;
}

async function downloadOrganizer(type) {
  if (!lastOrganizerOutput?.organizer) return;
  syncOrganizerEdits(lastOrganizerOutput.organizer);
  const organizer = lastOrganizerOutput.organizer;
  const fileName = `${type}-organizer-${organizer.clientName || "client"}-${organizer.taxYear || "year"}.docx`.replace(/[^a-z0-9.-]+/gi, "-");
  const text = type === "client" ? organizerClientDocumentText(organizer) : organizerPreparerDocumentText(organizer);
  await downloadWordDocument(fileName, text);
}

function organizerPreparerDocumentText(organizer) {
  const lines = [
    `Tax Organizer - ${organizer.clientName || "Client"} - Tax Year ${organizer.taxYear || ""}`,
    "PREPARER COPY - INTERNAL USE",
    "",
  ];
  (organizer.specialAttentionItems || []).forEach((item) => lines.push(`SPECIAL ATTENTION: ${item}`));
  lines.push("");
  (organizer.sections || []).forEach((section) => {
    lines.push(section.sectionName.toUpperCase(), section.sectionDescription || "", "Question | Document Required | PY Amount | Priority");
    (section.questions || []).forEach((question) => lines.push(`${question.question} | ${question.documentRequired || ""} | ${question.priorYearAmount || ""} | ${question.priority || ""}`));
    lines.push("");
  });
  lines.push("CARRYFORWARD ITEMS");
  (organizer.carryforwardItems || []).forEach((item) => lines.push(`${item.item} | ${item.priorYearAmount || ""} | ${item.note || ""}`));
  return lines.join("\n");
}

function organizerClientDocumentText(organizer) {
  const firmName = els.deliverableFirmName?.value.trim() || "Your CPA firm";
  const lines = [
    `${firmName} - Tax Organizer - ${organizer.clientName || "Client"} - ${organizer.taxYear || ""}`,
    "",
    `Dear ${organizer.clientName || "Client"}, please complete the following checklist and provide the requested documents so we can prepare your ${organizer.taxYear || ""} tax return.`,
    "",
  ];
  (organizer.sections || []).forEach((section) => {
    lines.push(section.sectionName.toUpperCase(), section.sectionDescription || "");
    (section.questions || []).forEach((question, index) => {
      lines.push(`${index + 1}. ${question.question}`, `Document needed: ${question.documentRequired || "As applicable"}`, "Response: ______________________________", "");
    });
  });
  lines.push(`Please return this completed organizer along with all documents to ${firmName} by the requested due date.`);
  return lines.join("\n");
}

function renderOrganizerMessage(type, title, message) {
  const tagClass = type === "warning" ? "warning" : "neutral";
  els.organizerResults.innerHTML = `<article><span class="tag ${tagClass}">${type === "warning" ? "Attention" : "Info"}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p></article>`;
}

async function runPreparerWorkflow() {
  const messages = validatePreparerInputs();
  renderPreparerValidation(messages);
  if (messages.some((item) => item.blocks)) return;

  els.prepStatus.textContent = "Running";
  els.runPreparer.disabled = true;
  els.prepRunHint.textContent = "Preparing uploaded files...";
  els.prepResults.innerHTML = `<article><span class="tag neutral">Running</span><h3>Generating Excel workpaper</h3><p>Claude is building workbook data and AI notes.</p></article>`;

  try {
    const files = [];
    for (const file of preparerFiles.packageFiles) files.push({ ...await prepareFileForReview({ file, type: "preparationPackage" }), type: "preparationPackage" });
    const payload = {
      metadata: {
        instructions: document.getElementById("prepNotes").value.trim(),
        taxSoftware: prepState.taxSoftware,
        taxSoftwareLabel: prepState.taxSoftwareLabel,
        taxYear: document.getElementById("prepCurrentYear")?.value || document.getElementById("taxYear")?.value || "",
        returnType: document.getElementById("returnType")?.value || document.getElementById("organizerReturnType")?.value || "",
        clientId: activePreparationClient()?.id || "",
        clientName: activePreparationClient()?.name || document.getElementById("clientName")?.value.trim() || document.getElementById("entityName")?.value.trim() || "",
      },
      clientId: activePreparationClient()?.id || "",
      taxSoftware: prepState.taxSoftware,
      files,
    };
    els.prepRunHint.textContent = "Sending preparation package to backend...";
    const response = await runWithCostEstimate("preparation", {
      returnType: payload.metadata?.returnType || "",
      hasWorkpaper: Boolean(payload.files?.length),
    }, () => fetch(`${API_BASE_URL}/api/prepare-workpaper`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }));
    const responsePayload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(responsePayload.error || `Backend returned ${response.status}`);
    // The backend uses a keep-alive heartbeat (always HTTP 200), so a failure is reported in
    // the body even on a 200 response.
    if (responsePayload.error && !responsePayload.workbook) throw new Error(responsePayload.error);
    lastPreparerOutput = {
      response:         responsePayload,
      payload,
      transactions8949: Array.isArray(responsePayload.transactions8949) ? responsePayload.transactions8949 : [],
      assets4562:       Array.isArray(responsePayload.assets4562)       ? responsePayload.assets4562       : [],
      w2s:              Array.isArray(responsePayload.w2s)              ? responsePayload.w2s              : [],
      int_1099s:        Array.isArray(responsePayload.int_1099s)        ? responsePayload.int_1099s        : [],
      div_1099s:        Array.isArray(responsePayload.div_1099s)        ? responsePayload.div_1099s        : [],
      ret_1099rs:       Array.isArray(responsePayload.ret_1099rs)       ? responsePayload.ret_1099rs       : [],
      ssa_1099s:        Array.isArray(responsePayload.ssa_1099s)        ? responsePayload.ssa_1099s        : [],
      nec_1099s:        Array.isArray(responsePayload.nec_1099s)        ? responsePayload.nec_1099s        : [],
      misc_1099s:       Array.isArray(responsePayload.misc_1099s)       ? responsePayload.misc_1099s       : [],
    };
    lastEntryGuideOutput = responsePayload.entryGuide ? { guide: validateEntryGuide(responsePayload.entryGuide) } : null;
    entryGuideGeneratedAt = responsePayload.entryGuide?.generatedAt || (lastEntryGuideOutput ? new Date().toISOString() : "");
    renderPreparerResult(responsePayload);
    els.prepExportActions.hidden = false;
    els.prepStatus.textContent = "Complete";
    await autosaveSession({ preparationResult: responsePayload });
  } catch (error) {
    els.prepStatus.textContent = "Failed";
    els.prepResults.innerHTML = `<article><span class="tag warning">Attention</span><h3>Template failed</h3><p>${escapeHtml(error.message || "The backend could not complete the preparer workflow.")}</p></article>`;
  } finally {
    els.runPreparer.disabled = false;
    els.prepRunHint.textContent = "The app will send your instructions and files to Claude, then build one Excel workbook with AI Notes and a software-specific Data Entry Guide.";
  }
}

function validatePreparerInputs() {
  const messages = [];
  if (!serverConfig.apiKeyConfigured) messages.push({ blocks: true, text: "Server API key is missing. Set ANTHROPIC_API_KEY before running the app." });
  if (!document.getElementById("prepNotes").value.trim()) messages.push({ blocks: true, text: "Write preparer instructions for the AI." });
  if (!preparerFiles.packageFiles.length) messages.push({ blocks: true, text: "Upload at least one preparation file or ZIP package." });
  return messages;
}

function renderPreparerValidation(messages) {
  if (!messages.length) {
    els.prepValidationMessages.innerHTML = "";
    return;
  }
  els.prepValidationMessages.innerHTML = messages.map((item) => `
    <div class="${item.blocks ? "validation-error" : "validation-warning"}">${escapeHtml(item.text)}</div>
  `).join("");
}

function renderPreparerFiles() {
  els.prepPriorCount.textContent = preparerFiles.packageFiles.length;
  els.prepReportCount.textContent = preparerFiles.packageFiles.filter((file) => fileExtension(file.name).toLowerCase() === "zip").length;
  els.prepPriorInlineCount.textContent = preparerFiles.packageFiles.length;
  els.prepReportsInlineCount.textContent = 0;
  renderSimpleFileList(els.prepPriorList, preparerFiles.packageFiles, "packageFiles");
  renderPreparerValidation(validatePreparerInputs().filter((item) => item.blocks && preparerFiles.packageFiles.length));
}

function renderSimpleFileList(list, files, type) {
  if (!files.length) {
    list.innerHTML = '<li class="empty-state">No files uploaded.</li>';
    return;
  }
  list.innerHTML = files.map((file, index) => `
    <li>
      <div>
        <div class="file-name">${escapeHtml(displayFileName(file))}</div>
        <div class="file-meta">${formatBytes(file.size)} Â· ${escapeHtml(fileExtension(file.name))}</div>
      </div>
      <button class="remove-file" type="button" data-prep-type="${type}" data-index="${index}">Remove</button>
    </li>
  `).join("");
  list.querySelectorAll(".remove-file").forEach((button) => {
    button.addEventListener("click", () => {
      preparerFiles[button.dataset.prepType].splice(Number(button.dataset.index), 1);
      invalidateEntryGuideCache();
      renderPreparerFiles();
    });
  });
}

function renderPreparerResult(response) {
  const summary = workbookSummary(response.workbook);
  const guide = response.entryGuide ? validateEntryGuide(response.entryGuide) : null;
  const isDrakeResult = isDrakeSelectedOrGeneratedGuide(guide);
  if (els.exportPrepDrake) els.exportPrepDrake.hidden = !isDrakeResult;
  if (els.exportPrepDrakeScript) els.exportPrepDrakeScript.hidden = !isDrakeResult;
  els.prepResults.innerHTML = `
    <article>
      <span class="tag success">Excel</span>
      <h3>Workbook ready</h3>
      <p>The Excel workpaper was generated successfully. The Data Entry Guide is included in the same workbook, so the download will not run a second AI generation.</p>
      <div class="workbook-ready-summary">
        <div><strong>${summary.sheetCount}</strong><span>Sheets</span></div>
        <div><strong>${summary.rowCount}</strong><span>Rows</span></div>
        <div><strong>${summary.noteCount}</strong><span>AI notes</span></div>
      </div>
      ${summary.sheetNames.length ? `<p class="muted-note">Included sheets: ${escapeHtml(summary.sheetNames.join(", "))}</p>` : ""}
    </article>
    <article class="entry-guide-card">
      <span class="tag success">Included</span>
      <h3>Data Entry Guide</h3>
      <p>${guide
        ? `${escapeHtml(guide.software || prepState.taxSoftwareLabel || "Selected tax software")} guide included with ${Number(guide.totalFields || 0)} mapped field${Number(guide.totalFields || 0) === 1 ? "" : "s"}.`
        : "The workbook includes the Data Entry Guide sheet generated from the selected tax software context."}</p>
      <div class="export-actions">
        <button id="previewEntryGuide" class="ghost-button small-button" type="button"${guide ? "" : " hidden"}>Preview Entry Guide</button>
        ${isDrakeResult
          ? `<button id="exportPrepDrakeInline" class="primary-button small-button" type="button">Export to Drake</button>
             <button id="exportPrepDrakeScriptInline" class="ghost-button small-button" type="button">Drake Auto-Entry Script</button>`
          : ""}
      </div>
      <p class="muted-note">Sheet name: <strong>Data Entry Guide</strong>. Software-specific instructions are generated during the first workbook run.</p>
    </article>
    ${isDrakeResult ? renderDrakeInputsPanel() : ""}
    ${renderCostSummary(response)}
  `;
  document.getElementById("previewEntryGuide")?.addEventListener("click", () => {
    if (!lastEntryGuideOutput?.guide) return;
    renderEntryGuidePreview(lastEntryGuideOutput.guide);
    if (els.entryGuideModal) {
      els.entryGuideModal.style.display = "flex";
      document.body.style.overflow = "hidden";
    }
  });
  document.getElementById("exportPrepDrakeInline")?.addEventListener("click", exportPreparerToDrake);
  document.getElementById("exportPrepDrakeScriptInline")?.addEventListener("click", downloadDrakeAutoEntryScript);
  // Drake import file buttons
  document.getElementById("drakeInputTrialBalance")?.addEventListener("click", exportPreparerToDrake);
  document.getElementById("drakeInputScheduleC")?.addEventListener("click", downloadDrakeScheduleC);
  document.getElementById("drakeInputForm8949")?.addEventListener("click", downloadDrakeForm8949);
  document.getElementById("drakeInputForm4562")?.addEventListener("click", downloadDrakeForm4562);
}

/** Return the entity type (1040 / 1120S / 1065 / 1120 / '') from the last preparer run. */
function drakeEntityTypeFromLastOutput() {
  if (!lastPreparerOutput) return "";
  const raw = lastPreparerOutput.response?.entryGuide?.returnType
    || lastPreparerOutput.payload?.metadata?.returnType
    || "";
  const up = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (up.includes("1120S")) return "1120S";
  if (up.includes("1065"))  return "1065";
  if (up.includes("1120"))  return "1120";
  if (up.includes("1040"))  return "1040";
  return "";
}

/** Render the Drake Import Files card HTML. */
function renderDrakeInputsPanel() {
  const et   = drakeEntityTypeFromLastOutput();
  const is1040     = et === "1040";
  const isBusiness = ["1120S", "1065", "1120"].includes(et);
  const etLabel    = et || "return";

  const tx8949  = lastPreparerOutput?.transactions8949 || [];
  const assets  = lastPreparerOutput?.assets4562       || [];
  const has8949 = tx8949.length > 0;
  const has4562 = assets.length > 0;

  const trialBalanceRow = `
    <div class="drake-input-row ${isBusiness ? "available" : "dimmed"}">
      <div class="drake-input-icon">TB</div>
      <div class="drake-input-info">
        <strong>Trial Balance</strong>
        <span>1120S · 1065 · 1120 &nbsp;·&nbsp; .xls → C:\\DRAKE25\\TB\\${isBusiness ? "" : " — not applicable for 1040"}</span>
      </div>
      ${isBusiness
        ? `<button class="primary-button small-button" id="drakeInputTrialBalance" type="button">Write to Drake →</button>`
        : `<span class="tag neutral">N/A</span>`}
    </div>`;

  const scheduleCRow = `
    <div class="drake-input-row ${is1040 ? "available" : "dimmed"}">
      <div class="drake-input-icon">SC</div>
      <div class="drake-input-info">
        <strong>Schedule C</strong>
        <span>1040 · Self-employment income &amp; expenses &nbsp;·&nbsp; .csv → C:\\DRAKE25\\IMPORT\\${is1040 ? "" : " — not applicable for " + escapeHtml(etLabel)}</span>
      </div>
      ${is1040
        ? `<button class="ghost-button small-button" id="drakeInputScheduleC" type="button">Download CSV</button>`
        : `<span class="tag neutral">N/A</span>`}
    </div>`;

  const form8949Row = `
    <div class="drake-input-row ${has8949 ? "available" : "dimmed"}">
      <div class="drake-input-icon">89</div>
      <div class="drake-input-info">
        <strong>Form 8949</strong>
        <span>Capital gains &nbsp;·&nbsp; .csv → C:\\DRAKE25\\IMPORT\\${has8949
          ? ` &nbsp;·&nbsp; <strong>${tx8949.length} transaction${tx8949.length === 1 ? "" : "s"} found</strong>`
          : " — upload a 1099-B or brokerage statement and regenerate"}</span>
      </div>
      ${has8949
        ? `<button class="ghost-button small-button" id="drakeInputForm8949" type="button">Download CSV</button>`
        : `<span class="tag neutral">No data</span>`}
    </div>`;

  const form4562Row = `
    <div class="drake-input-row ${has4562 ? "available" : "dimmed"}">
      <div class="drake-input-icon">45</div>
      <div class="drake-input-info">
        <strong>Form 4562</strong>
        <span>Depreciation &nbsp;·&nbsp; .xlsx → C:\\DRAKE25\\IMPORT\\${has4562
          ? ` &nbsp;·&nbsp; <strong>${assets.length} asset${assets.length === 1 ? "" : "s"} found</strong>`
          : " — upload a depreciation schedule or prior-year 4562 and regenerate"}</span>
      </div>
      ${has4562
        ? `<button class="ghost-button small-button" id="drakeInputForm4562" type="button">Download Excel</button>`
        : `<span class="tag neutral">No data</span>`}
    </div>`;

  return `
    <article class="entry-guide-card drake-inputs-card">
      <span class="tag success">Drake</span>
      <h3>Drake Import Files</h3>
      <p>Generate the structured files Drake Tax needs to load this ${escapeHtml(etLabel)} return. Open the client return in Drake before importing.</p>
      <div class="drake-inputs-list">
        ${trialBalanceRow}
        ${scheduleCRow}
        ${form8949Row}
        ${form4562Row}
      </div>
    </article>`;
}

function isDrakeSelectedOrGeneratedGuide(guide) {
  return [
    prepState.taxSoftware,
    prepState.taxSoftwareLabel,
    guide?.software,
    guide?.softwareName,
  ].some((value) => String(value || "").toLowerCase().includes("drake"));
}

function workbookSummary(workbook) {
  const sheets = workbook && Array.isArray(workbook.sheets) ? workbook.sheets : [];
  const rowCount = sheets.reduce((sum, sheet) => sum + (Array.isArray(sheet.rows) ? sheet.rows.length : 0), 0);
  const notes = Array.isArray(workbook?.aiNotes) ? workbook.aiNotes : [];
  return {
    sheetCount: sheets.length,
    rowCount,
    noteCount: notes.length,
    sheetNames: sheets.map((sheet) => safeText(sheet.name)).filter(Boolean).slice(0, 6),
  };
}

async function downloadPreparerWord() {
  if (!lastPreparerOutput) return;
  const baseName = "preparation-workpaper";
  downloadWorkbook(`${baseName}.xlsx`, lastPreparerOutput.response.workbook);
}

/** Shared helper — call /api/preparation/drake-generate and trigger browser download. */
async function callDrakeGenerate(fileType, buttonEl, options = {}) {
  if (!lastPreparerOutput) {
    showToast("Generate the preparation workpaper first.", "error");
    return;
  }
  const origText = buttonEl?.textContent || "";
  if (buttonEl) { buttonEl.disabled = true; buttonEl.textContent = "Generating…"; }

  try {
    const metadata = lastPreparerOutput.payload?.metadata || {};
    const client   = activePreparationClient();
    const response = await fetch(`${API_BASE_URL}/api/preparation/drake-generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileType,
        taxSoftware: prepState.taxSoftware,
        metadata,
        clientId: lastPreparerOutput.payload?.clientId || metadata.clientId || client?.id || "",
        client: {
          id:         client?.id         || metadata.clientId    || "",
          name:       client?.name       || metadata.clientName  || "",
          // options.ein (caller override) > client DB > workpaper metadata
          // For 1040 returns, 'ein' stores the taxpayer's SSN
          ein:        options.ein        || client?.ein          || metadata.ein || "",
          // Fallback chain: database client → metadata → AI-generated entryGuide returnType
          entityType: client?.returnType || client?.entityType   || metadata.returnType ||
                      lastPreparerOutput?.response?.entryGuide?.returnType || "",
        },
        workbook:         lastPreparerOutput.response?.workbook,
        entryGuide:       lastPreparerOutput.response?.entryGuide,
        transactions8949: lastPreparerOutput.transactions8949 || [],
        assets4562:       lastPreparerOutput.assets4562       || [],
        w2s:              lastPreparerOutput.w2s              || [],
        int_1099s:        lastPreparerOutput.int_1099s        || [],
        div_1099s:        lastPreparerOutput.div_1099s        || [],
        ret_1099rs:       lastPreparerOutput.ret_1099rs       || [],
        ssa_1099s:        lastPreparerOutput.ssa_1099s        || [],
        nec_1099s:        lastPreparerOutput.nec_1099s        || [],
        misc_1099s:       lastPreparerOutput.misc_1099s       || [],
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Backend returned ${response.status}`);

    // Decode base64 and trigger download
    const bytes    = Uint8Array.from(atob(data.contentBase64), c => c.charCodeAt(0));
    const blob     = new Blob([bytes], { type: data.mimeType || "application/octet-stream" });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement("a");
    a.href         = url;
    a.download     = data.filename || `drake_${fileType}.bin`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    showToast(`${data.filename || fileType} downloaded.`, "success");

    // Append success card to results
    els.prepResults?.insertAdjacentHTML("beforeend", `
      <article class="entry-guide-card">
        <span class="tag success">Drake</span>
        <h3>${escapeHtml(data.filename || fileType)} ready</h3>
        <p>File downloaded. Place it in the correct Drake import folder before importing.</p>
        <p class="muted-note"><code>${escapeHtml(data.filename || "")}</code></p>
      </article>
    `);
  } catch (err) {
    showToast(err.message || `${fileType} generation failed.`, "error");
    els.prepResults?.insertAdjacentHTML("beforeend", `
      <article>
        <span class="tag warning">Drake</span>
        <h3>${escapeHtml(fileType)} failed</h3>
        <p>${escapeHtml(err.message || "Could not generate the file.")}</p>
      </article>
    `);
  } finally {
    if (buttonEl) { buttonEl.disabled = false; buttonEl.textContent = origText; }
  }
}

async function downloadDrakeScheduleC() {
  await callDrakeGenerate("schedule_c", document.getElementById("drakeInputScheduleC"));
}

async function downloadDrakeForm8949() {
  await callDrakeGenerate("form_8949", document.getElementById("drakeInputForm8949"));
}

async function downloadDrakeForm4562() {
  await callDrakeGenerate("form_4562", document.getElementById("drakeInputForm4562"));
}

async function exportPreparerToDrake() {
  if (!lastPreparerOutput) {
    showToast("Generate the preparation workpaper before exporting to Drake.", "error");
    return;
  }
  if (!isDrakeSelectedOrGeneratedGuide(lastPreparerOutput.response?.entryGuide)) {
    showToast("Select Drake Tax as the tax software, then rerun the workpaper before exporting.", "error");
    return;
  }

  const button = els.exportPrepDrake;
  const originalText = button?.textContent || "Export to Drake";
  if (button) {
    button.disabled = true;
    button.textContent = "Exporting...";
  }

  try {
    const metadata = lastPreparerOutput.payload?.metadata || {};
    const client = activePreparationClient();
    const response = await fetch(`${API_BASE_URL}/api/preparation/export-drake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taxSoftware: prepState.taxSoftware,
        metadata,
        clientId: lastPreparerOutput.payload?.clientId || metadata.clientId || client?.id || "",
        client: {
          id: client?.id || metadata.clientId || "",
          name: client?.name || metadata.clientName || "",
          ein: client?.ein || metadata.ein || "",
          entityType: client?.returnType || client?.entityType || metadata.returnType || "",
        },
        workbook: lastPreparerOutput.response?.workbook,
        entryGuide: lastPreparerOutput.response?.entryGuide,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `Backend returned ${response.status}`);

    const skipped = Array.isArray(data.skipped) && data.skipped.length
      ? `<p class="muted-note">Skipped fields: ${escapeHtml(data.skipped.join(", "))}</p>`
      : "";
    els.prepResults.insertAdjacentHTML("beforeend", `
      <article class="entry-guide-card">
        <span class="tag success">Drake</span>
        <h3>Drake import file written</h3>
        <p>${escapeHtml(data.message || "The Drake import file was created successfully.")}</p>
        <p class="muted-note"><strong>File:</strong> ${escapeHtml(data.written || data.filename || "")}</p>
        <p class="muted-note"><strong>Fields loaded:</strong> ${Number(data.fieldsLoaded || 0)}</p>
        ${skipped}
      </article>
    `);
    showToast("Drake export file created.", "success");
  } catch (error) {
    els.prepResults.insertAdjacentHTML("beforeend", `
      <article>
        <span class="tag warning">Drake</span>
        <h3>Drake export failed</h3>
        <p>${escapeHtml(error.message || "The Drake import file could not be created.")}</p>
      </article>
    `);
    showToast(error.message || "Drake export failed.", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

function downloadDrakeAutoEntryScript() {
  if (!lastPreparerOutput) {
    showToast("Generate the preparation workpaper before creating a Drake auto-entry script.", "error");
    return;
  }
  const guide = lastPreparerOutput.response?.entryGuide ? validateEntryGuide(lastPreparerOutput.response.entryGuide) : null;
  if (!guide || !isDrakeSelectedOrGeneratedGuide(guide)) {
    showToast("Select Drake Tax and rerun the workpaper before creating the auto-entry script.", "error");
    return;
  }

  const steps = buildDrakeAutoEntrySteps(guide);
  if (!steps.length) {
    showToast("No Drake-ready fields were found in the Data Entry Guide.", "error");
    return;
  }

  const metadata = lastPreparerOutput.payload?.metadata || {};
  const clientName = safeText(guide.clientName || metadata.clientName || "client");
  const taxYear = safeText(guide.taxYear || metadata.taxYear || "");
  const script = buildDrakeAutoEntryPowerShell({
    clientName,
    taxYear,
    returnType: safeText(guide.returnType || metadata.returnType || ""),
    steps,
  });
  const suffix = [taxYear, clientName].filter(Boolean).join("-").replace(/[^a-z0-9_-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  downloadBlob(`drake-auto-entry${suffix ? `-${suffix}` : ""}.ps1`, script, "text/plain;charset=utf-8");
  showToast("Drake auto-entry script downloaded. Run it only with the correct Drake return open.", "success");
}

function buildDrakeAutoEntrySteps(guide) {
  const steps = [];
  for (const screen of guide.screens || []) {
    const screenCode = extractDrakeScreenCode(screen);
    for (const field of screen.fields || []) {
      const status = safeText(field.status).toLowerCase();
      if (status === "not_applicable") continue;
      const value = drakeAutoEntryValue(field);
      if (!value) continue;
      steps.push({
        screenPath: safeText(screen.screenPath),
        screenCode,
        fieldName: safeText(field.fieldName),
        fieldDescription: safeText(field.fieldDescription),
        value,
        source: safeText(field.valueSource || field.amountSource),
        status: safeText(field.status || "ready"),
        notes: safeText(field.statusNote || field.reviewIssueRef || screen.screenNotes),
        tabOrder: drakeFieldTabOrder(field),
      });
    }
  }
  return steps;
}

function drakeAutoEntryValue(field) {
  const value = field.value ?? field.amount;
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "X" : "";
  const text = safeText(value).trim();
  if (!text || /^n\/?a$/i.test(text) || /^not applicable$/i.test(text)) return "";
  return text;
}

function drakeFieldTabOrder(field) {
  const value = field.tabOrder ?? field.drakeTabOrder ?? field.fieldTabOrder;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 300 ? parsed : null;
}

function extractDrakeScreenCode(screen) {
  const text = [
    screen?.screenCode,
    screen?.drakeScreenCode,
    screen?.screenPath,
    screen?.screenDescription,
    screen?.softwareNavigation,
  ].map(safeText).join(" ");
  const explicit = text.match(/\b(?:screen|code|type)\s+([A-Z0-9]{1,6})\b/i);
  if (explicit) return explicit[1].toUpperCase();
  const leading = safeText(screen?.screenPath).match(/^\s*([A-Z0-9]{1,6})(?:\s*[-:|]|\s{2,})/i);
  if (leading) return leading[1].toUpperCase();

  const lower = text.toLowerCase();
  const mappings = [
    [/w-?2|wage|salary|salaries/, "W2"],
    [/1099-?r|retirement|pension/, "1099"],
    [/interest|1099-?int/, "INT"],
    [/dividend|1099-?div/, "DIV"],
    [/government payment|1099-?g|refund/, "99G"],
    [/estimated tax|estimate payment|voucher/, "ES"],
    [/itemized|schedule a|medical|charitable|mortgage interest|real estate tax|state income tax/, "A"],
    [/schedule c|business income|sole propriet/i, "C"],
    [/schedule e|rental|royalt/i, "E"],
    [/schedule f|farm/i, "F"],
    [/k-?1|partnership|s corporation shareholder|fiduciary k/, "K1"],
    [/depreciation|4562|asset/, "4562"],
    [/bank|direct deposit|withdrawal/, "BANK"],
    [/electronic filing|e-?file|ef selections/, "EF"],
    [/pdf attachment|attachment/, "PDF"],
    [/notes?|preparer notepad/, "PAD"],
  ];
  const match = mappings.find(([pattern]) => pattern.test(lower));
  return match ? match[1] : "";
}

function buildDrakeAutoEntryPowerShell({ clientName, taxYear, returnType, steps }) {
  const stepsJson = JSON.stringify(steps);
  const encodedSteps = btoa(unescape(encodeURIComponent(stepsJson)));
  const header = [
    "Drake Auto-Entry Script",
    `Client: ${clientName || "Client"}`,
    `Tax year: ${taxYear || "Not provided"}`,
    `Return type: ${returnType || "Not provided"}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "This script is supervised keyboard automation for Drake Tax.",
    "It does not modify Drake database files directly.",
    "Open the correct Drake return before running it.",
    "Review every field before moving to the next item.",
  ].join("\n");
  return `# ${header.replace(/\n/g, "\n# ")}
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
$wshell = New-Object -ComObject WScript.Shell
$stepsJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String("${encodedSteps}"))
$steps = $stepsJson | ConvertFrom-Json

function Activate-Drake {
  $titles = @("Drake 2025", "Drake 2026", "Drake", "Data Entry")
  foreach ($title in $titles) {
    try {
      if ($wshell.AppActivate($title)) {
        Start-Sleep -Milliseconds 350
        return $true
      }
    } catch {}
  }
  return $false
}

function Paste-Text([string]$text) {
  [System.Windows.Forms.Clipboard]::SetText($text)
  Start-Sleep -Milliseconds 120
  [System.Windows.Forms.SendKeys]::SendWait("^v")
}

function Send-DrakeScreen([string]$screenCode) {
  if ([string]::IsNullOrWhiteSpace($screenCode)) { return }
  Paste-Text $screenCode
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  Start-Sleep -Milliseconds 850
}

Write-Host ""
Write-Host "Drake Auto-Entry Script"
Write-Host "Client: ${escapePowerShellDoubleQuoted(clientName || "Client")}"
Write-Host "Tax year: ${escapePowerShellDoubleQuoted(taxYear || "Not provided")}"
Write-Host "Steps: $($steps.Count)"
Write-Host ""
Write-Host "Before continuing:"
Write-Host "1. Open Drake Tax."
Write-Host "2. Open the exact client return."
Write-Host "3. Click the 'Enter Screen, State or Search Phrase' box in Data Entry."
Write-Host ""
Read-Host "Press Enter to begin"

$index = 0
foreach ($step in $steps) {
  $index++
  Clear-Host
  Write-Host "Step $index of $($steps.Count)"
  Write-Host "Screen: $($step.screenPath)"
  Write-Host "Screen code: $($step.screenCode)"
  Write-Host "Field: $($step.fieldName)"
  if ($step.fieldDescription) { Write-Host "Description: $($step.fieldDescription)" }
  Write-Host "Value: $($step.value)"
  if ($step.source) { Write-Host "Source: $($step.source)" }
  if ($step.notes) { Write-Host "Notes: $($step.notes)" }
  Write-Host ""

  if (-not (Activate-Drake)) {
    Write-Host "Could not activate Drake automatically. Click Drake now."
    Read-Host "Press Enter after Drake is active"
  }

  if ($step.screenCode) {
    Write-Host "Navigating to screen $($step.screenCode)..."
    Send-DrakeScreen $step.screenCode
  } else {
    Write-Host "No reliable Drake screen code was provided for this step."
    Read-Host "Navigate to the correct Drake screen, then press Enter"
  }

  if ($step.tabOrder) {
    Write-Host "Using tab order $($step.tabOrder) before pasting the value."
    for ($i = 1; $i -le [int]$step.tabOrder; $i++) {
      [System.Windows.Forms.SendKeys]::SendWait("{TAB}")
      Start-Sleep -Milliseconds 45
    }
  } else {
    Write-Host "Click the exact Drake field for '$($step.fieldName)'."
    Read-Host "Press Enter to paste the value"
  }

  Paste-Text ([string]$step.value)
  Write-Host ""
  Read-Host "Verify the value in Drake, then press Enter for the next step"
}

Write-Host ""
Write-Host "Done. Review the full Drake return, calculate, and run diagnostics before filing."
Read-Host "Press Enter to close"
`;
}

function escapePowerShellDoubleQuoted(value) {
  return safeText(value).replace(/`/g, "``").replace(/\$/g, "`$").replace(/"/g, '`"');
}

function setupEntryGuideControls() {
  const software = document.getElementById("entryGuideSoftware");
  const saveDefault = document.getElementById("entryGuideSaveDefault");
  if (software) software.value = prepState.taxSoftware || readFirmDefaults().defaultTaxSoftware || localStorage.getItem("taxapp_default_software") || "proconnect";
  document.getElementById("downloadEntryGuideWorkbook")?.addEventListener("click", () => downloadEntryGuide());
  document.getElementById("previewEntryGuide")?.addEventListener("click", previewEntryGuide);
  document.getElementById("regenerateEntryGuide")?.addEventListener("click", async () => {
    invalidateEntryGuideCache();
    await previewEntryGuide({ force: true });
  });
  software?.addEventListener("change", () => {
    if (saveDefault?.checked) localStorage.setItem("taxapp_default_software", software.value);
    invalidateEntryGuideCache();
    updateEntryGuideStatus();
  });
  saveDefault?.addEventListener("change", () => {
    if (saveDefault.checked && software) localStorage.setItem("taxapp_default_software", software.value);
  });
  updateEntryGuideStatus();
}

function invalidateEntryGuideCache() {
  lastEntryGuideOutput = null;
  entryGuideGeneratedAt = "";
}

function updateEntryGuideStatus(message) {
  const status = document.getElementById("entryGuideRunStatus");
  const cache = document.getElementById("entryGuideCacheStatus");
  const regen = document.getElementById("regenerateEntryGuide");
  if (status && message) status.textContent = message;
  if (cache) cache.textContent = entryGuideCacheStatusText();
  if (regen) regen.hidden = !lastEntryGuideOutput;
}

function entryGuideCacheStatusText() {
  if (!lastEntryGuideOutput || !entryGuideGeneratedAt) return "No entry guide has been generated for this workbook yet.";
  const minutes = Math.max(1, Math.round((Date.now() - new Date(entryGuideGeneratedAt).getTime()) / 60000));
  return `Entry guide generated ${minutes} minute${minutes === 1 ? "" : "s"} ago.`;
}

async function ensureEntryGuide(options = {}) {
  if (!lastPreparerOutput) throw new Error("Generate a preparation workbook first.");
  if (lastEntryGuideOutput && !options.force) return lastEntryGuideOutput;

  const software = document.getElementById("entryGuideSoftware")?.value || prepState.taxSoftware || localStorage.getItem("taxapp_default_software") || "proconnect";
  const returnType = document.getElementById("returnType")?.value || document.getElementById("organizerReturnType")?.value || "1120";
  const taxYear = document.getElementById("taxYear")?.value || document.getElementById("prepCurrentYear")?.value || new Date().getFullYear();

  updateEntryGuideStatus(`Generating ${entryGuideSoftwareName(software)} entry guide...`);
  startEntryGuideLoadingMessages();
  try {
    const payload = entryGuideRequestPayload(software, returnType, taxYear);
    const response = await runWithCostEstimate("data_entry_guide", { returnType }, () => fetch(`${API_BASE_URL}/api/preparation/data-entry-guide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Backend returned ${response.status}`);
    const guide = validateEntryGuide(data.guide || {});
    lastEntryGuideOutput = { ...data, guide };
    entryGuideGeneratedAt = new Date().toISOString();
    updateEntryGuideStatus(`Entry guide ready. ${guide.totalFields || 0} fields mapped.`);
    return lastEntryGuideOutput;
  } finally {
    stopEntryGuideLoadingMessages();
  }
}

function entryGuideRequestPayload(software, returnType, taxYear) {
  const metadata = lastPreparerOutput?.payload?.metadata || {};
  const reviewMetadata = lastReview?.payload?.metadata || {};
  return {
    returnType,
    taxYear,
    taxSoftware: software,
    workpaperData: lastPreparerOutput?.response?.workbook || {},
    reviewResult: lastReview?.response || null,
    clientName: reviewMetadata.clientName || reviewMetadata.entityName || metadata.clientName || metadata.entityName || document.getElementById("clientName")?.value || document.getElementById("entityName")?.value || "",
    ein: reviewMetadata.ein || document.getElementById("ein")?.value || "",
    instructions: metadata.instructions || document.getElementById("prepNotes")?.value || "",
    qboReports: qboReportsForReview.map((file) => ({
      name: file.name,
      reportId: file.qboReportId,
      fetchedAt: file.qboFetchedAt,
      contentPreview: decodeBase64Text(file.content || "").slice(0, 10000),
    })),
  };
}

function entryGuideOutputTokens(returnType) {
  const map = { "1040": 3000, "1065": 4000, "1120": 4500, "1120-S": 4000, "990": 3500, "1041": 3500 };
  return map[String(returnType || "").toUpperCase()] || 3500;
}

function entryGuideSoftwareName(value) {
  const names = {
    proconnect: "ProConnect Tax",
    lacerte: "Lacerte",
    proseries: "ProSeries",
    drake: "Drake Tax",
    ultratax: "UltraTax CS",
    cch_axcess: "CCH Axcess",
    cch_prosystem: "CCH ProSystem fx",
    other: "the selected tax software",
  };
  return names[String(value || "").toLowerCase()] || prepState.taxSoftwareLabel || "the selected tax software";
}

let entryGuideLoadingTimer = null;
function startEntryGuideLoadingMessages() {
  const messages = [
    "Analyzing return type and screens...",
    "Mapping fields to selected tax software screens...",
    "Pre-calculating entry values...",
    "Ordering screens for efficient entry...",
    "Building Excel sheet...",
  ];
  let index = 0;
  updateEntryGuideStatus(messages[index]);
  clearInterval(entryGuideLoadingTimer);
  entryGuideLoadingTimer = setInterval(() => {
    index = (index + 1) % messages.length;
    updateEntryGuideStatus(messages[index]);
  }, 1600);
}

function stopEntryGuideLoadingMessages() {
  clearInterval(entryGuideLoadingTimer);
  entryGuideLoadingTimer = null;
}

async function previewEntryGuide(options = {}) {
  try {
    const output = await ensureEntryGuide(options);
    renderEntryGuidePreview(output.guide);
    if (els.entryGuideModal) {
      els.entryGuideModal.style.display = "flex";
      document.body.style.overflow = "hidden";
    }
  } catch (error) {
    if (error.message !== "Entry guide generation skipped.") {
      updateEntryGuideStatus(`Entry guide could not be generated. ${error.message}`);
      showToast(`Entry guide failed: ${error.message}`, "error");
    }
  }
}

async function downloadEntryGuide() {
  if (!lastPreparerOutput) return;
  try {
    const output = await ensureEntryGuide();
    const metadata = entryGuideRequestPayload(document.getElementById("entryGuideSoftware")?.value || "proconnect", output.guide.returnType, output.guide.taxYear);
    const baseName = `${metadata.clientName || "preparation-workpaper"}-${metadata.taxYear || "year"}`.replace(/[^a-z0-9-]+/gi, "-");
    downloadWorkbook(`${baseName}-with-entry-guide.xlsx`, lastPreparerOutput.response.workbook, output.guide);
  } catch (error) {
    if (error.message === "Entry guide generation skipped.") return;
    updateEntryGuideStatus(`Entry guide could not be generated. Downloading workpapers without entry guide tab. ${error.message}`);
    showToast("Entry guide failed. Downloading workpapers without it.", "warning");
    downloadPreparerWord();
  }
}

function closeEntryGuide() {
  if (els.entryGuideModal) {
    els.entryGuideModal.style.display = "none";
    document.body.style.overflow = "";
  }
}

function validateEntryGuide(guide) {
  const screens = Array.isArray(guide.screens) ? guide.screens : [];
  let nextScreen = 1;
  let nextField = 1;
  screens.forEach((screen) => {
    if (!Number(screen.screenNumber)) screen.screenNumber = nextScreen;
    nextScreen = Math.max(nextScreen, Number(screen.screenNumber) + 1);
    if (!Array.isArray(screen.fields)) screen.fields = [];
    screen.fields.forEach((field) => { field.fieldNumber = nextField++; });
  });
  screens.sort((a, b) => Number(a.screenNumber || 0) - Number(b.screenNumber || 0));
  guide.screens = screens;
  guide.totalFields = Number(guide.totalFields || screens.reduce((sum, screen) => sum + screen.fields.length, 0));
  guide.decisionItems = Array.isArray(guide.decisionItems) ? guide.decisionItems : [];
  guide.reviewIssueFields = Array.isArray(guide.reviewIssueFields) ? guide.reviewIssueFields : [];
  return guide;
}

function renderEntryGuidePreview(guideData) {
  const guide = validateEntryGuide(guideData);
  const progress = entryGuideProgress(guide);
  els.entryGuideSubtitle.textContent = `${guide.clientName || "Client"} | EIN: ${guide.ein || "Not provided"} | Form ${guide.returnType || ""} | TY ${guide.taxYear || ""}`;
  els.entryGuideStats.innerHTML = `
    <span>Total fields: <strong>${guide.totalFields || 0}</strong></span>
    <span>Decision needed: <strong>${guide.fieldsNeedingDecision || 0}</strong></span>
    <span>Review issues: <strong>${guide.fieldsFromReviewIssues || 0}</strong></span>
    <span id="entryGuideProgressText">${progress.checked} of ${progress.total} fields entered (${progress.percent}%)</span>
  `;
  els.entryGuideBody.innerHTML = guide.screens.map((screen) => `
    <section class="entry-guide-screen">
      <header>Screen ${Number(screen.screenNumber || 0)}: ${escapeHtml(screen.screenPath || "Input screen")}</header>
      ${screen.screenNotes ? `<p class="muted-note">${escapeHtml(screen.screenNotes)}</p>` : ""}
      <table class="entry-guide-table">
        <thead><tr><th>#</th><th>Field Name</th><th>Value to Enter</th><th>Source</th><th>Status</th><th>Notes / Action Required</th><th>Done</th></tr></thead>
        <tbody>
          ${(screen.fields || []).map((field) => {
            const fieldNumber = Number(field.fieldNumber || 0);
            return `
              <tr class="entry-status-${escapeHtml(field.status || "ready")}">
                <td>${fieldNumber}</td>
                <td><strong>${escapeHtml(field.fieldName || "")}</strong><br><small>${escapeHtml(screen.softwareNavigation || screen.screenPath || "")}</small></td>
                <td class="entry-guide-value">${escapeHtml(field.value || "")}</td>
                <td>${escapeHtml(field.valueSource || "")}</td>
                <td>${entryGuideStatusLabel(field.status)}</td>
                <td>${escapeHtml(field.statusNote || field.reviewIssueRef || "")}</td>
                <td><input type="checkbox" data-entry-field="${fieldNumber}" ${progress.checkedFields.has(fieldNumber) ? "checked" : ""}></td>
              </tr>`;
          }).join("")}
        </tbody>
      </table>
    </section>
  `).join("");
  els.entryGuideBody.querySelectorAll("[data-entry-field]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => saveEntryGuideProgress(guide));
  });
}

function entryGuideProgress(guide) {
  const key = `entry_guide_progress_${currentSessionId || "local"}`;
  let checkedFields = new Set();
  try {
    checkedFields = new Set((JSON.parse(localStorage.getItem(key) || "{}").checkedFields || []).map(Number));
  } catch (_) {}
  const total = Number(guide.totalFields || 0);
  const checked = [...checkedFields].filter((field) => field > 0).length;
  return { key, checkedFields, total, checked, percent: total ? Math.round((checked / total) * 100) : 0 };
}

function saveEntryGuideProgress(guide) {
  const checks = [...els.entryGuideBody.querySelectorAll("[data-entry-field]:checked")].map((input) => Number(input.dataset.entryField));
  localStorage.setItem(`entry_guide_progress_${currentSessionId || "local"}`, JSON.stringify({ checkedFields: checks }));
  const total = Number(guide.totalFields || 0);
  const progress = document.getElementById("entryGuideProgressText");
  if (progress) progress.textContent = `${checks.length} of ${total} fields entered (${total ? Math.round((checks.length / total) * 100) : 0}%)`;
}

function safeText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) return "";
    return trimmed;
  }
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(safeText).filter(Boolean).join("; ");
  if (typeof value === "object") {
    return safeText(value.label || value.name || value.title || value.description || value.summary || value.value || value.amount || "");
  }
  return String(value);
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safePriority(value) {
  const priority = safeText(value).toLowerCase();
  if (["high", "medium", "low", "info"].includes(priority)) return priority.toUpperCase();
  if (priority.includes("high")) return "HIGH";
  if (priority.includes("medium")) return "MEDIUM";
  if (priority.includes("low")) return "LOW";
  return "INFO";
}

function safeStatus(value) {
  const labels = {
    ready: "Ready",
    decision_needed: "Decision needed",
    verify: "Verify",
    review_issue: "Review issue",
    not_applicable: "Not applicable",
    complete: "Complete",
    pending: "Pending",
  };
  const key = safeText(value).toLowerCase().replace(/\s+/g, "_");
  return labels[key] || safeText(value) || "Pending";
}

function stripDocumentPrefix(value) {
  return safeText(value).replace(/^\s*(document|file|source)\s*[:#-]\s*/i, "");
}

function sanitizeIssue(issue = {}) {
  return {
    priority: safePriority(issue.priority || issue.severity),
    area: safeText(issue.formOrSchedule || issue.areaReviewed || issue.category || "Review item"),
    description: safeText(issue.issueDescription || issue.title || issue.detail || issue.description || "Issue noted."),
    evidence: safeText(issue.evidence),
    whyItMatters: safeText(issue.whyItMatters),
    riskAnalysis: safeText(issue.riskAnalysis),
    proposedSolution: safeText(issue.proposedSolution),
    recommendedAction: safeText(issue.recommendedAction || issue.recommendation),
    reviewerComment: safeText(issue.reviewerComment || issue.comment),
    authority: safeText(issue.authority || issue.citation || issue.taxAuthority),
    source: stripDocumentPrefix(issue.source || issue.document || issue.reference),
    needsMoreInfo: safeText(issue.needsMoreInfo),
  };
}

function compactOneLine(value, maxLength = 180) {
  const text = safeText(value).replace(/\s+/g, " ").trim();
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function issueSummaryLine(issue) {
  const item = sanitizeIssue(issue);
  return issueProblemPhrase(item);
}

function issueProblemPhrase(issue) {
  const text = [
    issue.area,
    issue.description,
    issue.evidence,
    issue.riskAnalysis,
    issue.proposedSolution,
    issue.recommendedAction,
  ].filter(Boolean).join(" ").toLowerCase();

  if (/(schedule\s*l|balance\s*sheet|assets|liabilities|equity)/.test(text) && /(not balance|out[- ]of[- ]balance|does not equal|do not equal|mismatch|difference|variance|tie)/.test(text)) {
    return "Schedule L not balanced";
  }
  if (/(w-?2|wage statement|payroll)/.test(text) && /(salary|salaries|wage|wages|compensation)/.test(text) && /(mismatch|does not match|not match|difference|variance|tie|reconcile|inconsistent)/.test(text)) {
    return "W-2 does not match salary information";
  }
  if (/(k-?1|schedule\s*k)/.test(text) && /(mismatch|does not match|not match|difference|variance|tie|reconcile|inconsistent)/.test(text)) {
    return "Schedule K-1 does not match return information";
  }
  if (/(depreciation|fixed asset|asset schedule)/.test(text) && /(mismatch|does not match|not match|difference|variance|tie|reconcile|inconsistent)/.test(text)) {
    return "Depreciation schedule does not match return";
  }
  if (/(checkbox|box|election)/.test(text) && /(incorrect|missing|not selected|selected|wrong|review)/.test(text)) {
    return "Checkbox or election needs review";
  }
  if (/(missing|not provided|unavailable|not included|absent)/.test(text)) {
    return `${issueSummarySubject(issue)} support missing`;
  }
  if (/(mismatch|does not match|not match|difference|variance|tie|reconcile|inconsistent)/.test(text)) {
    return `${issueSummarySubject(issue)} does not match support`;
  }
  return compactProblemPhrase(issue.description || issue.area || "Review item needs follow-up");
}

function issueSummarySubject(issue) {
  return compactOneLine(safeText(issue.area || issue.category || "Review item").replace(/\s+/g, " "), 48) || "Review item";
}

function compactProblemPhrase(value) {
  const text = safeText(value).replace(/\s+/g, " ").trim();
  const firstClause = text.split(/[.;]/)[0] || text;
  return compactOneLine(firstClause.replace(/^(issue|finding|problem)\s*[:.-]\s*/i, ""), 120);
}

function buildIssueSummaryLines(issues = []) {
  return [...(Array.isArray(issues) ? issues : [])]
    .map(sanitizeIssue)
    .filter((issue) => issue.description || issue.area)
    .sort((a, b) => priorityRank(a) - priorityRank(b))
    .map((issue) => issueSummaryLine(issue));
}

function sanitizeExcelCell(value) {
  const text = safeText(value);
  return text || "";
}

function entryGuideStatusLabel(status) {
  const labels = {
    ready: "READY",
    decision_needed: "DECISION",
    verify: "VERIFY",
    review_issue: "REVIEW ISSUE",
    not_applicable: "N/A",
  };
  const key = safeText(status || "ready").toLowerCase().replace(/\s+/g, "_");
  return labels[key] || safeStatus(status || "ready").toUpperCase();
}

function workbookPreviewText(workbook) {
  if (!workbook || !Array.isArray(workbook.sheets)) return "Workbook data was not returned.";
  return workbook.sheets.map((sheet) => {
    const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
    const preview = rows.slice(0, 8).map((row) => (Array.isArray(row) ? row : [row]).map(sanitizeExcelCell).join(" | ")).join("\n");
    return `# ${safeText(sheet.name) || "Sheet"}\n${preview || "No rows returned."}`;
  }).join("\n\n");
}

function downloadWorkbook(fileName, workbook, entryGuide) {
  const XLSX = window.XLSX;
  if (!XLSX) throw new Error("Excel engine is not loaded.");
  const wb = XLSX.utils.book_new();
  const sheets = workbook && Array.isArray(workbook.sheets) ? workbook.sheets : [];
  if (!sheets.length) {
    showToast("No structured workbook was generated. Please rerun the preparation with the prior-year Excel workpaper uploaded.", "error");
    return;
  }
  const normalizedSheets = sheets;
  normalizedSheets.forEach((sheet, index) => {
    const rows = Array.isArray(sheet.rows) && sheet.rows.length ? sheet.rows : [["No rows returned"]];
    const normalizedRows = rows.map((row) => (Array.isArray(row) ? row : [row]).map(sanitizeExcelCell));
    const ws = XLSX.utils.aoa_to_sheet(normalizedRows);
    if (Array.isArray(sheet.merges) && sheet.merges.length) ws["!merges"] = sheet.merges;
    ws["!cols"] = Array.isArray(sheet.cols) && sheet.cols.length ? sheet.cols : inferWorksheetColumns(normalizedRows);
    applyWorksheetStyles(ws, sheet, normalizedRows);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(safeText(sheet.name) || `Sheet ${index + 1}`));
  });
  if (!normalizedSheets.some((sheet) => String(sheet.name || "").toLowerCase() === "ai notes")) {
    const notes = workbook && Array.isArray(workbook.aiNotes) ? workbook.aiNotes : ["No AI notes were returned."];
    const ws = XLSX.utils.aoa_to_sheet([["AI Notes"], ...notes.map((note) => [sanitizeExcelCell(note)])]);
    XLSX.utils.book_append_sheet(wb, ws, "AI Notes");
  }
  if (entryGuide) addEntryGuideToWorkbook(wb, entryGuide);
  XLSX.writeFile(wb, fileName);
}

function inferWorksheetColumns(rows) {
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return Array.from({ length: maxCols }, (_, colIndex) => {
    const width = rows.reduce((max, row) => Math.max(max, String(row[colIndex] ?? "").length), 8);
    return { wch: Math.min(Math.max(width + 2, 10), 42) };
  });
}

function applyWorksheetStyles(ws, sheet, rows) {
  const XLSX = window.XLSX;
  const styles = Array.isArray(sheet.styles) ? sheet.styles : [];
  styles.forEach((style) => {
    const address = XLSX.utils.encode_cell({ r: Number(style.r) || 0, c: Number(style.c) || 0 });
    if (!ws[address]) ws[address] = { t: "s", v: "" };
    ws[address].s = worksheetStyleFromDescriptor(style);
  });
  rows.forEach((row, rowIndex) => {
    const nonEmpty = row.filter((cell) => String(cell ?? "").trim()).length;
    if (!nonEmpty) return;
    const looksLikeHeading = rowIndex === 0 || (nonEmpty <= 2 && String(row[0] || "").trim().length > 0);
    if (!looksLikeHeading) return;
    row.forEach((_cell, colIndex) => {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      if (!ws[address]) return;
      ws[address].s = ws[address].s || { font: {}, alignment: {} };
      ws[address].s.font = { ...(ws[address].s.font || {}), bold: true };
      ws[address].s.alignment = { ...(ws[address].s.alignment || {}), vertical: "center", wrapText: true };
    });
  });
}

function worksheetStyleFromDescriptor(style) {
  const cellStyle = { font: {}, alignment: { vertical: "center", wrapText: true } };
  if (style.bold) cellStyle.font.bold = true;
  if (style.underline) cellStyle.font.underline = true;
  if (style.fontColor) cellStyle.font.color = { rgb: String(style.fontColor).replace(/^#/, "").toUpperCase() };
  if (style.fill) cellStyle.fill = { fgColor: { rgb: String(style.fill).replace(/^#/, "").toUpperCase() } };
  if (style.numFmt) cellStyle.numFmt = style.numFmt;
  if (style.border) {
    const line = { style: "thin", color: { rgb: "808080" } };
    cellStyle.border = { top: line, bottom: line, left: line, right: line };
  }
  return cellStyle;
}

function addEntryGuideToWorkbook(workbook, guideData) {
  const XLSX = window.XLSX;
  const ws = buildEntryGuideSheet(guideData);
  const existing = workbook.SheetNames || [];
  for (const name of ["ProConnect Entry Guide", "Data Entry Guide"]) {
    if (!existing.includes(name)) continue;
    delete workbook.Sheets[name];
    workbook.SheetNames = workbook.SheetNames.filter((sheetName) => sheetName !== name);
  }
  XLSX.utils.book_append_sheet(workbook, ws, "Data Entry Guide");
  return workbook;
}

function buildEntryGuideSheet(guideData) {
  const XLSX = window.XLSX;
  const guide = validateEntryGuide(guideData);
  const rows = [
    [`${safeText(guide.software) || "Tax Software"} - Data Entry Guide`, "", "", "", "", "", "", ""],
    [`${safeText(guide.clientName) || "Client"} | EIN: ${safeText(guide.ein) || "Not provided"} | Form ${safeText(guide.returnType)} | TY ${safeText(guide.taxYear)}`, "", "", "", "", "", "", ""],
    [`Total fields: ${safeNumber(guide.totalFields)} | Ready to enter: ${countEntryGuideStatus(guide, "ready")} | Decision needed: ${safeNumber(guide.fieldsNeedingDecision)} | Verify: ${countEntryGuideStatus(guide, "verify")} | From review issues: ${safeNumber(guide.fieldsFromReviewIssues)} | Est. entry time: ${safeText(guide.estimatedEntryTime)}`, "", "", "", "", "", "", ""],
    [""],
    ["#", "Screen / Navigation Path", "Field Name", "Value to Enter", "Source", "Status", "Notes / Action Required", "Done"],
  ];

  let fieldNum = 1;
  for (const screen of guide.screens || []) {
    rows.push([`Screen ${safeText(screen.screenNumber) || ""}: ${safeText(screen.screenPath)}`, safeText(screen.softwareNavigation), "", "", "", "", safeText(screen.screenNotes), ""]);
    for (const field of screen.fields || []) {
      rows.push([
        fieldNum++,
        safeText(screen.screenPath),
        safeText(field.fieldName),
        sanitizeExcelCell(field.value),
        safeText(field.valueSource),
        entryGuideStatusLabel(field.status),
        safeText(field.statusNote || field.reviewIssueRef),
        "",
      ]);
    }
    rows.push([""]);
  }

  if ((guide.decisionItems || []).length) {
    rows.push([""], ["DECISION ITEMS - Preparer Action Required", "", "", "", "", "", "", ""], ["Screen", "Field", "Question", "Options", "Impact if Wrong", "", "", ""]);
    for (const item of guide.decisionItems) rows.push([safeText(item.screen), safeText(item.field), safeText(item.question), safeText(item.options), safeText(item.impactIfWrong), "", "", ""]);
  }
  if ((guide.reviewIssueFields || []).length) {
    rows.push([""], ["REVIEW ISSUES AFFECTING DATA ENTRY", "", "", "", "", "", "", ""], [`Resolve these issues in the Review tab before entering the affected fields in ${safeText(guide.software) || "the selected tax software"}.`, "", "", "", "", "", "", ""], ["Screen", "Field", "Issue Description", "Blocks Entry", "", "", "", ""]);
    for (const item of guide.reviewIssueFields) rows.push([safeText(item.screen), safeText(item.field), safeText(item.issue), item.blocksEntry ? "Yes" : "No", "", "", "", ""]);
  }
  rows.push([""], ["ENTRY CHECKLIST SUMMARY", "", "", "", "", "", "", ""], ["Screen name", "# fields", "Status summary", "", "", "", "", ""]);
  for (const screen of guide.screens || []) {
    rows.push([safeText(screen.screenPath), (screen.fields || []).length, screenStatusSummary(screen), "", "", "", "", ""]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows.map((row) => row.map(sanitizeExcelCell)));
  ws["!cols"] = [{ wch: 5 }, { wch: 30 }, { wch: 35 }, { wch: 20 }, { wch: 30 }, { wch: 18 }, { wch: 40 }, { wch: 6 }];
  ws["!freeze"] = { xSplit: 0, ySplit: 5 };
  return ws;
}

function countEntryGuideStatus(guide, status) {
  return (guide.screens || []).reduce((sum, screen) => sum + (screen.fields || []).filter((field) => field.status === status).length, 0);
}

function screenStatusSummary(screen) {
  const fields = screen.fields || [];
  return `Ready ${fields.filter((field) => field.status === "ready").length}; Decision ${fields.filter((field) => field.status === "decision_needed").length}; Verify ${fields.filter((field) => field.status === "verify").length}; Review issue ${fields.filter((field) => field.status === "review_issue").length}`;
}

function loadFirmDefaults() {
  try {
    const defaults = readFirmDefaults();
    els.deliverableFirmName.value = defaults.firmName || "";
    els.deliverableFirmAddress.value = defaults.firmAddress || "";
    els.deliverableFirmPhone.value = defaults.firmPhone || "";
    els.deliverableFirmEmail.value = defaults.firmEmail || "";
    els.deliverablePreparerName.value = defaults.preparerName || currentUsername || "";
  } catch (_) {
    els.deliverablePreparerName.value = currentUsername || "";
  }
}

function saveFirmDefaults() {
  const defaults = {
    ...readFirmDefaults(),
    firmName: els.deliverableFirmName.value.trim(),
    firmAddress: els.deliverableFirmAddress.value.trim(),
    firmPhone: els.deliverableFirmPhone.value.trim(),
    firmEmail: els.deliverableFirmEmail.value.trim(),
    preparerName: els.deliverablePreparerName.value.trim(),
  };
  localStorage.setItem("taxapp_firm_defaults", JSON.stringify(defaults));
}

function refreshDeliverableStatus() {
  els.deliverableReviewState.textContent = lastReview ? "Ready" : "Missing";
  els.deliverableNoticeState.textContent = lastNoticeAnalysis ? "Included" : "Optional";

  if (!lastReview) {
    els.deliverableStatusChip.textContent = "Waiting";
    els.deliverableStatusChip.className = "status-chip";
    els.deliverableStatus.className = "deliverable-status missing";
    els.deliverableStatus.innerHTML = `
      <strong>No review available.</strong>
      <span>Run a Senior Review first, then return here to generate deliverables.</span>`;
    setDeliverableButtonsDisabled(true);
    return;
  }

  const metadata = lastReview.payload.metadata || {};
  const structured = lastReview.response.structured || {};
  const readiness = deriveFilingReadiness(structured);
  const clientName = metadata.clientName || metadata.entityName || "Client not stated";
  const returnLabel = [metadata.returnType, metadata.taxYear].filter(Boolean).join(" - ") || "Return not stated";
  const balance = findReviewField(structured, ["balanceDueOrRefund", "refundOrBalance", "balanceDue", "refund"]) || "Not stated in review";
  if (!els.deliverableClientName.value.trim()) els.deliverableClientName.value = clientName;
  if (!els.deliverableRecipientName.value.trim()) els.deliverableRecipientName.value = clientName;

  els.deliverableStatusChip.textContent = readiness.label;
  els.deliverableStatusChip.className = `status-chip readiness-${readiness.className}`;
  els.deliverableStatus.className = `deliverable-status ${readiness.className}`;
  els.deliverableStatus.innerHTML = `
    <div><span>Client</span><strong>${escapeHtml(clientName)}</strong></div>
    <div><span>Return</span><strong>${escapeHtml(returnLabel)}</strong></div>
    <div><span>Filing readiness</span><strong>${escapeHtml(readiness.label)}</strong><small>${escapeHtml(readiness.reason)}</small></div>
    <div><span>Balance / refund</span><strong>${escapeHtml(balance)}</strong></div>`;
  setDeliverableButtonsDisabled(false);
}

function deriveFilingReadiness(structured = {}) {
  const issues = Array.isArray(structured.issues) ? structured.issues : [];
  const highIssues = issues.filter((issue) => normalizedPriority(issue) === "high");
  if (!highIssues.length) {
    return { value: "READY", label: "READY", className: "ready", reason: "Only medium, low, or informational items are open." };
  }
  const needsClientInfo = highIssues.some((issue) => issueNeedsMoreInfo(issue));
  if (needsClientInfo) {
    return { value: "NOT_READY", label: "NOT READY", className: "not-ready", reason: "At least one high-priority issue needs more information." };
  }
  return { value: "READY_WITH_CONDITIONS", label: "READY WITH CONDITIONS", className: "conditional", reason: "High-priority items appear preparer-resolvable before filing." };
}

function issueNeedsMoreInfo(issue) {
  const raw = issue.needsMoreInfo ?? issue.needsClientInfo ?? issue.missingInformation ?? "";
  if (typeof raw === "boolean") return raw;
  const text = String(raw).toLowerCase();
  return ["yes", "true", "needed", "missing", "client", "unable to verify"].some((term) => text.includes(term));
}

function findReviewField(structured, keys) {
  for (const key of keys) {
    if (structured && structured[key]) return structured[key];
  }
  return "";
}

function setDeliverableButtonsDisabled(disabled) {
  [els.generateTransmittal, els.generateChecklist, els.generateEmailDraft, els.generateAllDeliverables].forEach((button) => {
    button.disabled = disabled;
  });
}

async function runDeliverable(type) {
  if (!lastReview) {
    refreshDeliverableStatus();
    renderDeliverableMessage("warning", "No review available", "Run a Senior Review first, then return here to generate deliverables.");
    return;
  }

  setDeliverableRunning(true, type);
  try {
    if (els.deliverableSaveDefaults.checked) saveFirmDefaults();
    const payload = buildDeliverablePayload(type);
    const endpoint = type === "email" ? "/api/deliverable/email-draft" : "/api/deliverable";
    const response = await runWithCostEstimate("deliverable", {
      returnType: payload.returnType || lastReview?.payload?.metadata?.returnType || "",
      hasWorkpaper: Boolean(payload.reviewResult),
    }, () => fetch(`${API_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }));
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "The backend could not generate the deliverable.");
    lastDeliverableOutput = { response: result, type, payload };
    renderDeliverableResult(result.deliverable || {}, type, result);
    await autosaveSession({ deliverableResult: result.deliverable || {}, status: "delivered" });
  } catch (error) {
    renderDeliverableMessage("warning", "Deliverable generation failed", error.message || "The backend could not complete the deliverable.");
  } finally {
    setDeliverableRunning(false);
  }
}

function buildDeliverablePayload(type) {
  const structured = lastReview.response.structured || {};
  const metadata = lastReview.payload.metadata || {};
  const readiness = deriveFilingReadiness(structured);
  return {
    reviewResult: structured,
    noticeResult: lastNoticeAnalysis || null,
    organizerResult: lastOrganizerOutput?.organizer || null,
    diagnosticsResult: lastDiagnosticsOutput?.diagnostics || null,
    clientName: els.deliverableClientName.value.trim() || metadata.clientName || metadata.entityName || "",
    preparerName: els.deliverablePreparerName.value.trim() || currentUsername,
    firmName: els.deliverableFirmName.value.trim(),
    firmAddress: els.deliverableFirmAddress.value.trim(),
    firmPhone: els.deliverableFirmPhone.value.trim(),
    firmEmail: els.deliverableFirmEmail.value.trim(),
    deliverableType: type === "email" ? "all" : type,
    customInstructions: els.deliverableCustomInstructions.value.trim(),
    recipientEmail: els.deliverableClientEmail.value.trim(),
    recipientName: els.deliverableRecipientName.value.trim() || els.deliverableClientName.value.trim(),
    emailTone: els.deliverableEmailTone.value,
    derivedFilingReadiness: readiness.value,
    derivedFilingReadinessReason: readiness.reason,
  };
}

function setDeliverableRunning(isRunning, type = "") {
  setDeliverableButtonsDisabled(isRunning || !lastReview);
  els.deliverableRunHint.textContent = isRunning
    ? `Generating ${type === "email" ? "email draft" : type}...`
    : "Choose one output or generate the full client package.";
}

function renderDeliverableResult(deliverable, requestedType, wrapper) {
  const sections = [];
  if ((requestedType === "transmittal" || requestedType === "all") && deliverable.transmittalLetter) sections.push(renderTransmittalCard(deliverable));
  if ((requestedType === "checklist" || requestedType === "all") && deliverable.clientActionChecklist?.length) sections.push(renderChecklistCard(deliverable));
  if ((requestedType === "email" || requestedType === "all") && (deliverable.emailDraft?.subject || deliverable.emailDraft?.body)) sections.push(renderEmailCard(deliverable));
  if (!sections.length) {
    sections.push(`<article><span class="tag warning">Attention</span><h3>No client-ready content returned</h3><pre class="written-output">${escapeHtml(deliverable.raw || wrapper?.raw || "")}</pre></article>`);
  }
  els.deliverableResults.innerHTML = `${sections.join("")}${renderCostSummary(wrapper || {})}`;
  bindDeliverableResultActions(deliverable);
}

function renderTransmittalCard(deliverable) {
  return `
    <details class="deliverable-card" open>
      <summary>Transmittal Letter</summary>
      <textarea id="transmittalText" class="deliverable-textarea" rows="16">${escapeHtml(deliverable.transmittalLetter || "")}</textarea>
      <div class="card-actions">
        <button id="copyTransmittal" class="ghost-button small-button" type="button">Copy text</button>
        <button id="downloadTransmittal" class="primary-button small-button" type="button">Download .docx</button>
      </div>
    </details>`;
}

function renderChecklistCard(deliverable) {
  const items = deliverable.clientActionChecklist || [];
  return `
    <details class="deliverable-card" open>
      <summary>Client Action Checklist</summary>
      <div id="clientChecklistItems" class="deliverable-checklist">
        ${items.map((item, index) => `
          <label class="checklist-card urgency-${String(item.urgency || "MEDIUM").toLowerCase()}">
            <input type="checkbox" />
            <span>
              <strong contenteditable="true" data-checklist-field="item" data-index="${index}">${escapeHtml(item.item || "")}</strong>
              <small contenteditable="true" data-checklist-field="reason" data-index="${index}">${escapeHtml(item.reason || "")}</small>
              <em contenteditable="true" data-checklist-field="howToProvide" data-index="${index}">${escapeHtml(item.howToProvide || "")}</em>
            </span>
            <b>${escapeHtml(item.urgency || "MEDIUM")}</b>
          </label>`).join("")}
      </div>
      <div class="card-actions">
        <button id="downloadChecklist" class="primary-button small-button" type="button">Download .docx</button>
      </div>
    </details>`;
}

function renderEmailCard(deliverable) {
  return `
    <details class="deliverable-card" open>
      <summary>Client Email Draft</summary>
      <label class="field full">
        <span>Subject</span>
        <input id="emailSubjectDraft" class="email-field" type="text" value="${escapeHtml(deliverable.emailDraft?.subject || "")}" />
      </label>
      <label class="field full">
        <span>Body</span>
        <textarea id="emailBodyDraft" class="deliverable-textarea" rows="14">${escapeHtml(deliverable.emailDraft?.body || "")}</textarea>
      </label>
      <div class="card-actions">
        <button id="copyEmailSubject" class="ghost-button small-button" type="button">Copy subject</button>
        <button id="copyEmailBody" class="ghost-button small-button" type="button">Copy body</button>
        <button id="openMailto" class="primary-button small-button" type="button">Open email</button>
      </div>
    </details>`;
}

function bindDeliverableResultActions(deliverable) {
  document.getElementById("copyTransmittal")?.addEventListener("click", () => copyText(document.getElementById("transmittalText").value));
  document.getElementById("downloadTransmittal")?.addEventListener("click", () => {
    downloadWordDocument("transmittal-letter.docx", document.getElementById("transmittalText").value);
  });
  document.getElementById("downloadChecklist")?.addEventListener("click", () => {
    downloadWordDocument("client-action-checklist.docx", checklistToText(readChecklistFromDom(deliverable)));
  });
  document.getElementById("copyEmailSubject")?.addEventListener("click", () => copyText(document.getElementById("emailSubjectDraft").value));
  document.getElementById("copyEmailBody")?.addEventListener("click", () => copyText(document.getElementById("emailBodyDraft").value));
  document.getElementById("openMailto")?.addEventListener("click", openEmailDraft);
}

function readChecklistFromDom(deliverable) {
  const items = deliverable.clientActionChecklist || [];
  document.querySelectorAll("[data-checklist-field]").forEach((node) => {
    const index = Number(node.dataset.index);
    const field = node.dataset.checklistField;
    if (items[index] && field) items[index][field] = node.textContent.trim();
  });
  return items;
}

function checklistToText(items) {
  const lines = ["CLIENT ACTION CHECKLIST", ""];
  if (!items.length) lines.push("No checklist items returned.");
  items.forEach((item, index) => {
    lines.push(
      `${index + 1}. [${item.urgency || "MEDIUM"}] ${item.item || ""}`,
      `Reason: ${item.reason || ""}`,
      `How to provide: ${item.howToProvide || ""}`,
      ""
    );
  });
  return lines.join("\n");
}

function openEmailDraft() {
  const recipient = els.deliverableClientEmail.value.trim();
  const subject = document.getElementById("emailSubjectDraft")?.value || "";
  const body = document.getElementById("emailBodyDraft")?.value || "";
  window.location.href = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function copyText(text) {
  navigator.clipboard?.writeText(text || "");
}

function renderDeliverableMessage(type, title, message) {
  const tagClass = type === "warning" ? "warning" : "neutral";
  els.deliverableResults.innerHTML = `
    <article>
      <span class="tag ${tagClass}">${type === "warning" ? "Attention" : "Info"}</span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
    </article>`;
}

function showDrivePlaceholder() {
  const modal = document.createElement("div");
  modal.className = "simple-modal";
  modal.innerHTML = `
    <div class="simple-modal-card">
      <h3>Coming soon</h3>
      <p>Google Drive client-folder saving is planned. See the integration guide before connecting a production account.</p>
      <button class="primary-button small-button" type="button">Close</button>
    </div>`;
  modal.querySelector("button").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });
  document.body.appendChild(modal);
}

function setupDeliverableEvents() {
  document.querySelectorAll('input[name="deliverableClientMode"]').forEach((input) => input.addEventListener("change", updateDeliverableClientMode));
  [els.deliverableClientName, els.deliverableClientEmail, els.deliverableClientCompany].forEach((input) => input?.addEventListener("input", updateDeliverableFlow));
  els.deliverableConnectDrive?.addEventListener("click", connectGoogleDrive);
  els.deliverableSelectFolder?.addEventListener("click", openDeliverableFolderPicker);
  els.deliverableAddDriveFiles?.addEventListener("click", openDeliverableDriveFiles);
  els.deliverableAddComputerFiles?.addEventListener("click", () => els.deliverableComputerFiles?.click());
  els.deliverableComputerFiles?.addEventListener("change", () => {
    addDeliverableFiles(Array.from(els.deliverableComputerFiles.files || []), "computer");
    els.deliverableComputerFiles.value = "";
  });
  els.generateEmailDraft?.addEventListener("click", () => generateDeliverableEmailDraft());
  els.regenerateDeliverableEmail?.addEventListener("click", () => generateDeliverableEmailDraft({ force: true }));
  els.copyDeliverableEmail?.addEventListener("click", copyDeliverableEmail);
  els.openDeliverableGmail?.addEventListener("click", (event) => createDeliverableGmailDraft(event.currentTarget));
  els.connectGmailButton?.addEventListener("click", (event) => createDeliverableGmailDraft(event.currentTarget));
  els.sendGmailButton?.addEventListener("click", (event) => createDeliverableGmailDraft(event.currentTarget));
  ["deliverableFirmName", "deliverableFirmEmail", "deliverableFirmPhone", "deliverablePreparerName"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", () => {
      if (els.deliverableSaveDefaults?.checked) saveFirmDefaults();
    });
  });
  els.deliverableSaveDefaults?.addEventListener("change", () => { if (els.deliverableSaveDefaults.checked) saveFirmDefaults(); });
}

function updateDeliverableClientMode() {
  const mode = document.querySelector('input[name="deliverableClientMode"]:checked')?.value || "drive";
  if (els.deliverableDriveClientMode) els.deliverableDriveClientMode.hidden = mode !== "drive";
  if (els.deliverableManualClientMode) els.deliverableManualClientMode.hidden = mode !== "manual";
  updateDeliverableFlow();
}

async function refreshDeliverableStatus() {
  if (els.deliverableReviewState) els.deliverableReviewState.textContent = lastReview ? "Ready" : "Missing";
  if (els.deliverableNoticeState) els.deliverableNoticeState.textContent = lastNoticeAnalysis ? "Included" : "Optional";
  prefillDeliverableFromSession();
  await refreshDeliverableGmailStatus();
  updateDeliverableFlow();
}

function prefillDeliverableFromSession() {
  const metadata = lastReview?.payload?.metadata || getMetadata?.() || {};
  if (!els.deliverableClientName?.value.trim()) els.deliverableClientName.value = metadata.clientName || metadata.entityName || els.deliverableClientName.value || "";
  if (!els.deliverableReturnType?.value) els.deliverableReturnType.value = metadata.returnType || "";
  if (!els.deliverableTaxYear?.value) els.deliverableTaxYear.value = metadata.taxYear || "";
  if (!els.deliverableReviewStage?.value) els.deliverableReviewStage.value = normalizeDeliverableStage(metadata.reviewStage || "Initial");
  if (!els.deliverableDeadline?.value) els.deliverableDeadline.value = defaultFilingDeadline(els.deliverableReturnType?.value, els.deliverableTaxYear?.value);
  const structured = lastReview?.response?.structured || {};
  const readiness = deriveFilingReadiness(structured);
  const filingInput = document.querySelector(`input[name="deliverableFilingStatus"][value="${readiness.value}"]`);
  if (filingInput) filingInput.checked = true;
  const balance = findReviewField(structured, ["balanceDueOrRefund", "refundOrBalance", "balanceDue", "refund"]);
  if (balance && !els.deliverableBalance.value.trim()) els.deliverableBalance.value = balance;
}

function normalizeDeliverableStage(stage) {
  const text = String(stage || "").toLowerCase();
  if (text.includes("final")) return "Final review";
  return "Initial review";
}

function defaultFilingDeadline(returnType, taxYear) {
  const year = Number(taxYear || new Date().getFullYear());
  if (!year) return "";
  const type = String(returnType || "").toUpperCase();
  const monthDay = ["1065", "1120-S"].includes(type) ? "03-15" : type === "1040" || type === "1041" ? "04-15" : "04-15";
  return `${year + 1}-${monthDay}`;
}

async function refreshDeliverableGmailStatus() {
  try {
    const status = await fetch(`${API_BASE_URL}/api/deliverable/gmail-status`).then((r) => r.json());
    deliverableState.gmailStatus = status;
    renderGmailStatus();
  } catch (_) {
    deliverableState.gmailStatus = { authorized: false, email: null };
    renderGmailStatus();
  }
}

function updateDeliverableFlow() {
  const emailReady = isValidEmail(els.deliverableClientEmail?.value || "");
  const clientMissing = [];
  if (!emailReady) clientMissing.push("Enter a valid client email.");
  if (!els.deliverableClientName?.value.trim() || !els.deliverableClientCompany?.value.trim()) clientMissing.push("Client name and company are strongly encouraged.");
  els.deliverableClientStatus.innerHTML = emailReady
    ? `<div class="${clientMissing.length > 1 ? "validation-warning" : "validation-success"}">${clientMissing.length > 1 ? clientMissing.slice(1).join(" ") : "Client info ready."}</div>`
    : `<div class="validation-error">${clientMissing[0]}</div>`;
  els.deliverableClientSection?.classList.toggle("complete", emailReady);
  if (els.deliverableClientCheck) els.deliverableClientCheck.hidden = !emailReady;
  els.deliverableFilesSection?.classList.toggle("locked", !emailReady);
  const filesReady = deliverableState.files.length > 0;
  els.deliverableFilesSection?.classList.toggle("complete", filesReady);
  if (els.deliverableFilesCheck) els.deliverableFilesCheck.hidden = !filesReady;
  els.deliverableFileStatus.innerHTML = filesReady ? `<div class="validation-success">${deliverableState.files.length} file(s) ready to attach.</div>` : "";
  els.deliverableEmailSection?.classList.toggle("locked", !(emailReady && filesReady));
  if (els.generateEmailDraft) els.generateEmailDraft.disabled = false;
  if (els.gmailTo && !els.gmailTo.value.trim()) els.gmailTo.value = els.deliverableClientEmail?.value || "";
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function openDeliverableFolderPicker() {
  DrivePicker.open({
    title: "Select Client Info",
    subtitle: "Select a Word, Google Doc, TXT, JSON file, or a client folder",
    allowedTypes: ["docx", "txt", "json", "pdf"],
    multiSelect: false,
    folderOnly: false,
    onFilesSelected: async (items) => {
      const item = items[0];
      if (!item) return;
      if (item.kind === "folder" || (!item.content && item.id)) await loadDeliverableClientFolder(item);
      else await loadDeliverableClientInfoFile(item);
    },
  });
}

async function loadDeliverableClientInfoFile(file) {
  deliverableState.clientFolder = null;
  els.deliverableDriveLoaded.hidden = false;
  els.deliverableDriveLoaded.textContent = `Reading client info file: ${file.name}...`;
  try {
    const response = await fetch(`${API_BASE_URL}/api/deliverable/load-client-folder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        file: {
          name: file.name,
          mimeType: file.type || file.mimeType,
          contentBase64: file.content,
          driveFileId: file.driveFileId,
        },
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not read file.");
    els.deliverableClientName.value = data.name || "";
    els.deliverableClientEmail.value = data.email || "";
    els.deliverableClientCompany.value = data.company || "";
    const confidence = String(data.confidence || "low");
    els.deliverableDriveLoaded.innerHTML = `Loaded from file: <strong>${escapeHtml(data.sourceFile || file.name)}</strong> &middot; Confidence: <span class="confidence-dot confidence-${confidence}"></span>${escapeHtml(confidence)}`;
    if (els.deliverableSaveClientInfo.checked) saveDeliverableClientInfo();
  } catch (error) {
    els.deliverableDriveLoaded.innerHTML = `<span class="validation-error">${escapeHtml(error.message)}</span>`;
  }
  updateDeliverableFlow();
}

async function loadDeliverableClientFolder(folder) {
  deliverableState.clientFolder = folder;
  els.deliverableDriveLoaded.hidden = false;
  els.deliverableDriveLoaded.textContent = `Reading client folder: ${folder.name}...`;
  try {
    const response = await fetch(`${API_BASE_URL}/api/deliverable/load-client-folder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folderId: folder.id }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not read folder.");
    els.deliverableClientName.value = data.name || "";
    els.deliverableClientEmail.value = data.email || "";
    els.deliverableClientCompany.value = data.company || data.folderName || "";
    deliverableState.clientFolder = { id: data.folderId, name: data.folderName };
    const confidence = String(data.confidence || "low");
    els.deliverableDriveLoaded.innerHTML = `Loaded from: <strong>${escapeHtml(data.folderName || folder.name)}</strong> ${data.sourceFile ? ` &middot; Source file: ${escapeHtml(data.sourceFile)}` : ""} &middot; Confidence: <span class="confidence-dot confidence-${confidence}"></span>${escapeHtml(confidence)}`;
    if (els.deliverableSaveClientInfo.checked) saveDeliverableClientInfo();
  } catch (error) {
    els.deliverableDriveLoaded.innerHTML = `<span class="validation-error">${escapeHtml(error.message)}</span>`;
  }
  updateDeliverableFlow();
}

async function saveDeliverableClientInfo() {
  if (!currentSessionId) return;
  await autosaveSession({
    client: {
      name: els.deliverableClientName.value.trim(),
      email: els.deliverableClientEmail.value.trim(),
      company: els.deliverableClientCompany.value.trim(),
      driveFolderId: deliverableState.clientFolder?.id || "",
      driveFolderName: deliverableState.clientFolder?.name || "",
    },
  }).catch(() => null);
}

function openDeliverableDriveFiles() {
  const config = {
    title: "Select Files to Send to Client",
    subtitle: "Select the documents you want to attach to the email",
    allowedTypes: ["pdf", "docx", "xlsx"],
    multiSelect: true,
    onFilesSelected: (files) => addDeliverableFiles(files, "google_drive"),
  };
  if (deliverableState.clientFolder?.id) {
    config.folderId = deliverableState.clientFolder.id;
  }
  DrivePicker.open(config);
}

function addDeliverableFiles(files, source) {
  const mapped = files.map((file) => ({
    file,
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: displayFileName(file),
    size: file.size || 0,
    mimeType: file.type || guessMediaType(file.name),
    source: source || file.source || "computer",
    docType: guessDeliverableDocType(file.name),
  }));
  deliverableState.files.push(...mapped);
  renderDeliverableFiles();
  updateDeliverableFlow();
}

function guessDeliverableDocType(name) {
  const lower = String(name || "").toLowerCase();
  if (lower.includes("return") || /\b(1040|1065|1120|990)\b/.test(lower)) return "Tax Return";
  if (lower.includes("workpaper") || lower.includes("wp")) return "Workpaper";
  if (lower.includes("engagement")) return "Engagement Letter";
  if (lower.includes("invoice")) return "Invoice";
  if (lower.includes("organizer") || lower.includes("checklist")) return "Organizer / Checklist";
  if (lower.includes("notice") || lower.includes("response")) return "Notice Response";
  return "Supporting Document";
}

function renderDeliverableFiles() {
  if (!deliverableState.files.length) {
    els.deliverableFileList.innerHTML = `<div class="deliverable-file-empty">No files selected - add files below.</div>`;
    return;
  }
  els.deliverableFileList.innerHTML = deliverableState.files.map((item, index) => `
    <div class="deliverable-file-item" draggable="true" data-deliverable-file="${item.id}">
      <span class="drive-file-icon">${deliverableFileIcon(item.mimeType)}</span>
      <div class="drive-file-info">
        <div class="drive-file-name">${escapeHtml(item.name)} ${item.source === "google_drive" ? '<span class="qbo-badge">DRIVE</span>' : ""}</div>
        <div class="drive-file-meta">${formatBytes(item.size)} Â· ${escapeHtml(item.mimeType || "")}</div>
      </div>
      <select class="deliverable-file-type-select" data-file-type-index="${index}">
        ${["Tax Return", "Workpaper", "Engagement Letter", "Invoice", "Organizer / Checklist", "Notice Response", "Supporting Document", "Other"].map((type) => `<option${item.docType === type ? " selected" : ""}>${type}</option>`).join("")}
      </select>
      <button class="remove-file" type="button" data-remove-deliverable-file="${item.id}">Remove</button>
    </div>
  `).join("");
  els.deliverableFileList.querySelectorAll("[data-file-type-index]").forEach((select) => select.addEventListener("change", () => {
    deliverableState.files[Number(select.dataset.fileTypeIndex)].docType = select.value;
  }));
  els.deliverableFileList.querySelectorAll("[data-remove-deliverable-file]").forEach((button) => button.addEventListener("click", () => {
    deliverableState.files = deliverableState.files.filter((item) => item.id !== button.dataset.removeDeliverableFile);
    renderDeliverableFiles();
    updateDeliverableFlow();
  }));
  setupDeliverableDragSort();
}

function deliverableFileIcon(mimeType) {
  if ((mimeType || "").includes("pdf")) return "PDF";
  if ((mimeType || "").includes("word") || (mimeType || "").includes("document")) return "DOC";
  if ((mimeType || "").includes("sheet") || (mimeType || "").includes("excel")) return "XLS";
  return "FILE";
}

function setupDeliverableDragSort() {
  let draggedId = "";
  els.deliverableFileList.querySelectorAll(".deliverable-file-item").forEach((row) => {
    row.addEventListener("dragstart", () => { draggedId = row.dataset.deliverableFile; });
    row.addEventListener("dragover", (event) => event.preventDefault());
    row.addEventListener("drop", () => {
      const targetId = row.dataset.deliverableFile;
      if (!draggedId || draggedId === targetId) return;
      const from = deliverableState.files.findIndex((item) => item.id === draggedId);
      const to = deliverableState.files.findIndex((item) => item.id === targetId);
      const [moved] = deliverableState.files.splice(from, 1);
      deliverableState.files.splice(to, 0, moved);
      renderDeliverableFiles();
    });
  });
}

async function generateDeliverableEmailDraft() {
  if (!validateDeliverableEmailInputs()) return;
  if (els.deliverableSaveDefaults?.checked) saveFirmDefaults();
  if (els.deliverableSaveClientInfo?.checked) await saveDeliverableClientInfo();
  const payload = buildDeliverableEmailPayload();
  els.generateEmailDraft.disabled = true;
  els.generateEmailDraft.textContent = "Generating email draft...";
  try {
    const response = await runWithCostEstimate("deliverable", {
      returnType: payload.context?.returnType || "",
      hasWorkpaper: Boolean(payload.attachments?.length),
    }, () => fetch(`${API_BASE_URL}/api/deliverable/generate-draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The backend could not generate the email draft.");
    deliverableState.draft = data.draft;
    lastDeliverableOutput = { response: data, type: "email", payload };
    renderDeliverableDraft(data);
    await autosaveSession({ deliverableResult: data.draft });
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    els.generateEmailDraft.disabled = false;
    els.generateEmailDraft.textContent = "Generate Email Draft";
  }
}

function validateDeliverableEmailInputs() {
  const errors = [];
  if (!isValidEmail(els.deliverableClientEmail?.value || "")) errors.push("Enter a valid client email.");
  if (!deliverableState.files.length) errors.push("Select at least one file to attach.");
  if (!els.deliverableClientName?.value.trim()) errors.push("Enter the client name.");
  if (!errors.length) {
    updateDeliverableFlow();
    return true;
  }
  if (els.deliverableClientStatus) {
    els.deliverableClientStatus.innerHTML = errors.map((error) => `<div class="validation-error">${escapeHtml(error)}</div>`).join("");
  }
  showToast(errors[0], "warning");
  if (!isValidEmail(els.deliverableClientEmail?.value || "")) els.deliverableClientEmail?.focus();
  else if (!els.deliverableClientName?.value.trim()) els.deliverableClientName?.focus();
  return false;
}

function buildDeliverableEmailPayload() {
  const structured = lastReview?.response?.structured || {};
  const issues = Array.isArray(structured.issues) ? structured.issues : [];
  const openIssues = issues.filter((issue) => normalizedPriority(issue) === "high");
  return {
    client: {
      name: els.deliverableClientName.value.trim(),
      email: els.deliverableClientEmail.value.trim(),
      company: els.deliverableClientCompany.value.trim(),
    },
    preparer: {
      name: els.deliverablePreparerName.value.trim(),
      firmName: els.deliverableFirmName.value.trim(),
      email: els.deliverableFirmEmail.value.trim(),
      phone: els.deliverableFirmPhone.value.trim(),
    },
    attachments: deliverableState.files.map((item) => ({ name: item.name, type: item.docType, description: item.docType })),
    context: {
      returnType: els.deliverableReturnType.value,
      taxYear: els.deliverableTaxYear.value.trim(),
      reviewStage: els.deliverableReviewStage.value,
      hasOpenIssues: openIssues.length > 0,
      openIssuesCount: openIssues.length,
      balanceDue: els.deliverableBalance.value.trim(),
      filingDeadline: els.deliverableDeadline.value,
      filingReadiness: document.querySelector('input[name="deliverableFilingStatus"]:checked')?.value || "READY",
      customInstructions: els.deliverableCustomInstructions.value.trim(),
      openIssues: openIssues.map((issue) => issue.description || issue.issue || issue.summary || "").filter(Boolean),
    },
    tone: els.deliverableEmailTone.value,
  };
}

function renderDeliverableDraft(response) {
  const draft = response.draft || response;
  els.deliverableDraftPanel.hidden = false;
  els.emailSubjectDraft.value = draft.subject || "";
  els.emailBodyDraft.value = draft.body || "";
  els.deliverableKeyPoints.innerHTML = `
    ${(draft.keyPoints || []).length ? `<strong>Key points</strong><ul>${draft.keyPoints.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
    ${draft.callToAction ? `<p><strong>Call to action:</strong> ${escapeHtml(draft.callToAction)}</p>` : ""}
    ${renderCostSummary(response)}
  `;
  if (els.gmailTo) els.gmailTo.value = els.deliverableClientEmail.value.trim();
  renderGmailStatus();
}

function renderGmailStatus() {
  const status = deliverableState.gmailStatus || {};
  if (els.gmailFrom) els.gmailFrom.textContent = status.email || "Not connected";
  if (els.gmailNotConnected) els.gmailNotConnected.hidden = Boolean(status.authorized);
  if (els.gmailSendForm) els.gmailSendForm.hidden = !status.authorized;
  if (els.gmailAttachmentsSummary) {
    els.gmailAttachmentsSummary.innerHTML = `<strong>Attachments</strong><ul>${deliverableState.files.map((item) => `<li>${escapeHtml(item.name)} - ${escapeHtml(item.source === "google_drive" ? "Drive" : "Computer")}</li>`).join("")}</ul>`;
  }
}

function copyDeliverableEmail() {
  copyText(`Subject: ${els.emailSubjectDraft.value}\n\n${els.emailBodyDraft.value}`);
  showToast("Email copied.", "success");
}

function openDeliverableMailto() {
  const to = els.gmailTo?.value || els.deliverableClientEmail.value.trim();
  const subject = els.emailSubjectDraft.value || "";
  const body = `${els.emailBodyDraft.value || ""}\n\nNote: attachments must be added manually in Gmail.`;
  window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function collectDeliverableEmailAttachments() {
  const attachments = [];
  for (const item of deliverableState.files) {
    attachments.push({
      name: item.name,
      mimeType: item.mimeType || guessMediaType(item.name),
      contentBase64: await readAsBase64(item.file),
      size: item.size || 0,
    });
  }
  return attachments;
}

function buildDeliverableGmailPayload(attachments) {
  return {
    to: els.gmailTo.value.trim(),
    cc: els.gmailAdditionalCc.value.trim(),
    ccPreparer: els.gmailCcSelf.checked,
    preparerEmail: els.deliverableFirmEmail.value.trim() || deliverableState.gmailStatus.email,
    subject: els.emailSubjectDraft.value.trim(),
    bodyText: els.emailBodyDraft.value,
    bodyHtml: plainTextEmailToHtml(els.emailBodyDraft.value),
    attachments,
  };
}

async function createDeliverableGmailDraft(triggerButton) {
  if (creatingDeliverableGmailDraft) return;
  pendingDeliverableGmailDraft = true;
  await refreshDeliverableGmailStatus();
  if (!deliverableState.gmailStatus?.authorized) {
    showToast("Grant Gmail permission, then the draft will be created automatically.", "info");
    connectGoogleDrive();
    return;
  }
  if (!deliverableState.draft && !els.emailSubjectDraft.value.trim()) {
    await generateDeliverableEmailDraft();
  }
  if (!els.emailSubjectDraft.value.trim() || !els.emailBodyDraft.value.trim()) {
    showToast("Generate the email draft before opening Gmail.", "warning");
    pendingDeliverableGmailDraft = false;
    return;
  }
  const gmailTab = window.open("about:blank", "_blank", "noopener");
  const button = triggerButton || els.sendGmailButton || els.connectGmailButton || els.openDeliverableGmail;
  const originalButtonText = button?.textContent || "";
  creatingDeliverableGmailDraft = true;
  if (button) {
    button.disabled = true;
    button.textContent = "Creating Gmail draft...";
  }
  try {
    const attachments = await collectDeliverableEmailAttachments();
    const response = await fetch(`${API_BASE_URL}/api/deliverable/create-gmail-draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildDeliverableGmailPayload(attachments)),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Gmail could not create the draft.");
    pendingDeliverableGmailDraft = false;
    const url = data.gmailUrl || "https://mail.google.com/mail/u/0/#drafts";
    if (gmailTab) {
      gmailTab.location.href = url;
    } else {
      window.open(url, "_blank", "noopener");
    }
    els.gmailSendResult.innerHTML = `<div class="send-success-banner">Gmail draft created with ${attachments.length} attachment(s).<br><a href="${escapeHtml(url)}" target="_blank" rel="noopener">Open Gmail drafts</a></div>`;
  } catch (error) {
    if (gmailTab) gmailTab.close();
    els.gmailSendResult.innerHTML = `<div class="gmail-not-connected">${escapeHtml(error.message)}</div>`;
    if (String(error.message || "").toLowerCase().includes("permission")) connectGoogleDrive();
  } finally {
    creatingDeliverableGmailDraft = false;
    if (button) {
      button.disabled = false;
      button.textContent = originalButtonText || "Create Draft in Gmail";
    }
  }
}

async function sendDeliverableGmail() {
  const attachments = await collectDeliverableEmailAttachments();
  const payload = {
    ...buildDeliverableGmailPayload(attachments),
  };
  els.sendGmailButton.disabled = true;
  els.sendGmailButton.textContent = "Sending email...";
  try {
    const response = await fetch(`${API_BASE_URL}/api/deliverable/send-gmail`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Gmail could not send the email.");
    const record = { sentAt: new Date().toISOString(), to: payload.to, subject: payload.subject, attachmentNames: attachments.map((item) => item.name), status: "Sent", messageId: data.messageId };
    deliverableState.sendHistory.unshift(record);
    renderDeliverableSendHistory();
    els.gmailSendResult.innerHTML = `<div class="send-success-banner">Email sent successfully<br>Sent to: ${escapeHtml(payload.to)}<br>Message ID: ${escapeHtml(data.messageId || "")}</div>`;
    await autosaveSession({
      deliverableResult: { draft: deliverableState.draft, sent: record },
      deliverableSent: {
        ...record,
        taxYear: els.deliverableTaxYear.value.trim() || getMetadata()?.taxYear || "",
      },
      status: "delivered",
    });
  } catch (error) {
    els.gmailSendResult.innerHTML = `<div class="gmail-not-connected">${escapeHtml(error.message)}</div>`;
  } finally {
    els.sendGmailButton.disabled = false;
    els.sendGmailButton.textContent = "Send Email";
  }
}

function renderDeliverableSendHistory() {
  els.deliverableSendHistorySection.hidden = deliverableState.sendHistory.length === 0;
  els.deliverableSendHistory.innerHTML = deliverableState.sendHistory.map((item) => `
    <tr><td>${formatDateTime(item.sentAt)}</td><td>${escapeHtml(item.to)}</td><td>${escapeHtml(item.subject)}</td><td>${escapeHtml((item.attachmentNames || []).join(", "))}</td><td>${escapeHtml(item.status)}</td></tr>
  `).join("");
}

function plainTextEmailToHtml(text) {
  return String(text || "").split(/\n{2,}/).map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`).join("");
}

function safeSheetName(name) {
  const cleaned = String(name || "Sheet").replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim();
  return cleaned || "Sheet";
}

async function prepareFileForReview({ file, type }) {
  const guessedRole = guessReviewFileRole(file);
  const base = {
    name: displayFileName(file),
    type,
    role: type === "taxReturns" ? normalizeReviewRoleValue(taxReturnRoles.get(fileKey(file)) || guessedRole) : "",
    size: file.size,
    mediaType: file.type || guessMediaType(file.name),
  };

  const ext = fileExtension(file.name).toLowerCase();
  if (ext === "zip") {
    try {
      const extracted = await extractZipPackage(file);
      return {
        ...base,
        encoding: "zip-text",
        text: extracted.text,
        workbookTemplate: extracted.workbookTemplates[0] || null,
        workbookTemplates: extracted.workbookTemplates,
      };
    } catch (error) {
      console.warn("ZIP package parse failed:", error);
      return { ...base, encoding: "metadata-only" };
    }
  }

  if (base.mediaType === "application/pdf" || ext === "pdf") {
    try {
      return { ...base, encoding: "pdf-text", text: await extractPdfText(file) };
    } catch (error) {
      console.warn("PDF text parse failed:", error);
      return { ...base, encoding: "metadata-only" };
    }
  }

  if (["xlsx", "xls"].includes(ext)) {
    try {
      const extracted = await extractXlsxWithTemplate(file);
      return { ...base, encoding: "xlsx-text", text: extracted.text, workbookTemplate: extracted.template };
    } catch (error) {
      console.warn("XLSX parse failed:", error);
      return { ...base, encoding: "metadata-only" };
    }
  }

  if (["docx", "doc"].includes(ext)) {
    try {
      return { ...base, encoding: "docx-text", text: await extractDocx(file) };
    } catch (error) {
      console.warn("DOCX parse failed:", error);
      return { ...base, encoding: "metadata-only" };
    }
  }

  if (isTextLikeFile(base.mediaType, file.name)) {
    return { ...base, encoding: "text", text: await fileTextContent(file) };
  }

  return { ...base, encoding: "metadata-only" };
}

async function extractZipPackageText(file) {
  return (await extractZipPackage(file)).text;
}

async function extractZipPackage(file) {
  const innerFiles = await extractZipFiles(file);
  const sections = [];
  const workbookTemplates = [];
  for (const innerFile of innerFiles) {
    const ext = fileExtension(innerFile.name).toLowerCase();
    try {
      let text = "";
      if (ext === "zip") {
        const nested = await extractZipPackage(innerFile);
        text = nested.text;
        workbookTemplates.push(...nested.workbookTemplates);
      }
      else if (ext === "pdf") text = await extractPdfText(innerFile);
      else if (["xlsx", "xls"].includes(ext)) {
        const extracted = await extractXlsxWithTemplate(innerFile);
        text = extracted.text;
        workbookTemplates.push(extracted.template);
      }
      else if (["docx", "doc"].includes(ext)) text = await extractDocx(innerFile);
      else if (isTextLikeFile(innerFile.type || guessMediaType(innerFile.name), innerFile.name)) text = await fileTextContent(innerFile);
      if (text.trim()) {
        sections.push([
          `--- ZIP ENTRY: ${displayFileName(innerFile)} ---`,
          text.trim(),
        ].join("\n"));
      }
    } catch (error) {
      sections.push(`--- ZIP ENTRY: ${displayFileName(innerFile)} ---\nUnable to parse this entry: ${error.message || "unknown error"}`);
    }
  }
  return {
    text: sections.length ? sections.join("\n\n") : "No readable files found inside ZIP package.",
    workbookTemplates,
  };
}

async function extractXlsx(file) {
  return (await extractXlsxWithTemplate(file)).text;
}

async function extractXlsxWithTemplate(file) {
  const XLSX = window.XLSX;
  if (!XLSX) throw new Error("SheetJS not loaded");
  const buffer = await fileArrayBuffer(file);
  const workbook = XLSX.read(buffer, { type: "array", cellStyles: true });
  const parts = [];
  const template = {
    sourceFileName: displayFileName(file),
    sheets: [],
  };
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim()) parts.push(`--- Sheet: ${sheetName} ---\n${csv}`);
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" })
      .slice(0, 250)
      .map((row) => row.slice(0, 80).map((cell) => sanitizeExcelCell(cell)));
    template.sheets.push({
      name: sheetName,
      rows,
      merges: Array.isArray(sheet["!merges"]) ? sheet["!merges"].slice(0, 100) : [],
      cols: Array.isArray(sheet["!cols"]) ? sheet["!cols"].slice(0, 80).map((col) => ({ wch: col.wch || col.width || undefined })) : [],
      styles: extractWorksheetStyleDescriptors(sheet),
    });
  }
  return { text: parts.join("\n\n"), template };
}

function extractWorksheetStyleDescriptors(sheet) {
  const XLSX = window.XLSX;
  if (!sheet || !sheet["!ref"] || !XLSX) return [];
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const styles = [];
  const maxRow = Math.min(range.e.r, range.s.r + 249);
  const maxCol = Math.min(range.e.c, range.s.c + 79);
  for (let r = range.s.r; r <= maxRow; r += 1) {
    for (let c = range.s.c; c <= maxCol; c += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      const descriptor = styleDescriptorFromCell(cell, r - range.s.r, c - range.s.c);
      if (descriptor) styles.push(descriptor);
      if (styles.length >= 1000) return styles;
    }
  }
  return styles;
}

function styleDescriptorFromCell(cell, r, c) {
  const style = cell?.s || {};
  const font = style.font || {};
  const fill = style.fill || {};
  const border = style.border || {};
  const descriptor = { r, c };
  if (font.bold) descriptor.bold = true;
  if (font.underline) descriptor.underline = true;
  if (font.color?.rgb) descriptor.fontColor = font.color.rgb;
  if (fill.fgColor?.rgb && fill.fgColor.rgb !== "00000000") descriptor.fill = fill.fgColor.rgb;
  if (style.numFmt) descriptor.numFmt = style.numFmt;
  if (border.top || border.bottom || border.left || border.right) descriptor.border = true;
  return Object.keys(descriptor).length > 2 ? descriptor : null;
}

async function extractDocx(file) {
  const mammoth = window.mammoth;
  if (!mammoth) throw new Error("mammoth not loaded");
  const buffer = await fileArrayBuffer(file);
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value || "";
}

async function extractPdfText(file) {
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) throw new Error("PDF parser not loaded");
  if (pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/assets/vendor/pdf.worker.min.js";
  }
  const pdf = await pdfjsLib.getDocument({ data: await fileArrayBuffer(file) }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str || "").join(" ").replace(/\s+/g, " ").trim();
    if (text) pages.push(`--- Page ${pageNumber} ---\n${text}`);
  }
  return pages.join("\n\n");
}

function renderFiles() {
  const totalBytes = getAllFiles().reduce((sum, item) => sum + item.file.size, 0);
  els.totalSize.textContent = formatBytes(totalBytes);
  const allReviewFiles = filesByType.taxReturns;
  assignDefaultTaxReturnRoles();
  counters.taxReturns.textContent = allReviewFiles.length;
  counters.workpapers.textContent = allReviewFiles.filter((file) => normalizeReviewRoleValue(taxReturnRoles.get(fileKey(file)) || "").includes("workpaper")).length;
  counters.documents.textContent = allReviewFiles.filter((file) => normalizeReviewRoleValue(taxReturnRoles.get(fileKey(file)) || "supporting_document") === "supporting_document").length;

  Object.keys(filesByType).forEach((type) => {
    inlineCounters[type].textContent = filesByType[type].length;

    if (!filesByType[type].length) {
      lists[type].innerHTML = '<li class="empty-state">No files uploaded.</li>';
      return;
    }

    lists[type].innerHTML = filesByType[type].map((file, index) => {
      const ext = fileExtension(file.name);
      return `
        <li>
          <div>
            <div class="file-name">${escapeHtml(displayFileName(file))}</div>
            <div class="file-meta">${formatBytes(file.size)} Â· ${escapeHtml(ext)} Â· ${readabilityLabel(ext)}</div>
            ${type === "taxReturns" ? renderTaxReturnRole(file) : ""}
          </div>
          <button class="remove-file" type="button" data-type="${type}" data-index="${index}">Remove</button>
        </li>`;
    }).join("");
  });

  document.querySelectorAll(".return-role").forEach((select) => {
    select.addEventListener("change", () => {
      taxReturnRoles.set(select.dataset.key, select.value);
      renderFiles();
      renderValidation(validateBeforeReview({ showWarnings: true }));
    });
  });

  document.querySelectorAll(".remove-file").forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.type;
      const removed = filesByType[type].splice(Number(button.dataset.index), 1);
      if (type === "taxReturns" && removed[0]) taxReturnRoles.delete(fileKey(removed[0]));
      renderFiles();
      renderValidation(validateBeforeReview({ showWarnings: true }));
    });
  });

  updateStepper();
}

function validateBeforeReview({ showWarnings }) {
  const messages = [];
  const totalBytes = getAllFiles().reduce((sum, item) => sum + item.file.size, 0);
  const maxTotalBytes = Number(serverConfig.maxUploadMb || 0) > 0
    ? Number(serverConfig.maxUploadMb) * 1024 * 1024
    : DEFAULT_MAX_TOTAL_BYTES;

  if (!serverConfig.apiKeyConfigured) {
    messages.push({ blocks: true, text: "Server API key is missing. Set ANTHROPIC_API_KEY before running the app." });
  }

  if (!getAllFiles().length) {
    messages.push({ blocks: true, text: "Please upload at least one review package file before running the review." });
  }

  if (totalBytes > maxTotalBytes) {
    messages.push({ blocks: true, text: `The uploaded files exceed the ${serverConfig.maxUploadMb || 64} MB size limit. Please remove files or split the documents.` });
  }

  if (showWarnings && getAllFiles().length && !filesByType.taxReturns.some((file) => fileExtension(file.name).toLowerCase() === "zip")) {
    messages.push({ blocks: false, text: "No ZIP package uploaded. The review can continue with individual files, but a ZIP is usually better for complete client packages." });
  }

  if (showWarnings && filesByType.taxReturns.length && !filesByType.taxReturns.some((file) => normalizeReviewRoleValue(taxReturnRoles.get(fileKey(file)) || guessReviewFileRole(file)) === "current_return")) {
    messages.push({ blocks: false, text: "No current year return is marked. The review may be incomplete without the return being reviewed." });
  }

  if (showWarnings && getAllFiles().length && !filesByType.taxReturns.some((file) => normalizeReviewRoleValue(taxReturnRoles.get(fileKey(file)) || guessReviewFileRole(file)) === "current_workpaper")) {
    messages.push({ blocks: false, text: "No current year workpaper detected. Numeric tie-out checks may be incomplete." });
  }

  if (showWarnings && !document.getElementById("userNotes").value.trim()) {
    messages.push({ blocks: false, text: "No specific instructions entered. Claude will run the standard senior review checklist." });
  }

  if (showWarnings && !document.getElementById("clientFacts").value.trim()) {
    messages.push({ blocks: false, text: "No client facts entered. Claude will only verify facts found in uploaded documents." });
  }

  if (showWarnings && !serverConfig.knowledgeBaseCount) {
    messages.push({ blocks: false, text: "No readable knowledge base files are configured. Add IRS/state instructions through the production knowledge base storage." });
  }

  return messages;
}

function renderValidation(messages) {
  if (!messages.length) {
    els.validationMessages.innerHTML = "";
    return;
  }

  els.validationMessages.innerHTML = messages.map((message) => `
    <div class="${message.blocks ? "validation-item blocks" : "validation-item"}">${escapeHtml(message.text)}</div>
  `).join("");
}

function renderProgress(labels, completedIndex) {
  if (labels) {
    els.progressList.hidden = false;
    els.progressList.innerHTML = labels.map((label, index) => `
      <div class="progress-item" data-index="${index}">
        <span>${index + 1}</span>
        <strong>${escapeHtml(label)}</strong>
      </div>
    `).join("");
    els.results.innerHTML = `
      <article class="feed-empty">
        <span class="tag neutral">Analyzing</span>
        <h3>Claude is reviewing the package</h3>
        <p>Findings will stream into this feed when the structured review is ready.</p>
      </article>
      <article class="skeleton-card"></article>
      <article class="skeleton-card compact"></article>`;
  }

  Array.from(els.progressList.querySelectorAll(".progress-item")).forEach((item, index) => {
    item.classList.toggle("done", index < completedIndex);
    item.classList.toggle("active", index === completedIndex);
  });
}

function renderReviewResult(payload, metadata) {
  const structured = normalizeReviewForExport(payload, metadata);
  const raw = payload.review || "";
  const model = payload.model || "";
  const client = metadata.entityName || metadata.clientName || "Unnamed client";
  const taxYear = metadata.taxYear || "not specified";

  if (structured && Array.isArray(structured.issues) && hasSeniorReviewSubstance(structured)) {
    payload.structured = structured;
    payload.issueResponses = payload.issueResponses || issueResolutionState || {};
    issueResolutionState = payload.issueResponses;
    const memo = toCleanWrittenReview({ structured }, metadata);
    els.results.innerHTML = `
      <article>
        <span class="tag ${readinessTagClass(structured.filingReadiness)}">${escapeHtml(structured.filingReadiness || "Complete")}</span>
        <h3>${escapeHtml(client)} - Tax year ${escapeHtml(taxYear)}</h3>
        <p>${escapeHtml(structured.executiveSummary || structured.summary || "Review complete.")}</p>
        ${structured.overallRiskScore ? `<p><strong>Overall risk score:</strong> ${escapeHtml(structured.overallRiskScore)}</p>` : ""}
        ${renderCostSummary(payload)}
      </article>
      ${renderDocumentsReadSection(structured.documentsRead)}
      ${renderFeedbackAppliedSection(structured.feedbackApplied)}
      ${renderResolutionSummary(structured, metadata)}
      ${renderIssueSummarySection(structured.issues)}
      ${renderIssueSection("Issues and response tracking", structured.issues)}
      ${renderCheckboxReviewSection(structured.checkboxReview)}
      ${renderTieOutSection(structured.tieOutResults)}
      ${renderBalanceSheetCheckSection(structured.balanceSheetCheck)}
      ${renderEfileDiagnosticsCta(structured, metadata)}
      <article>
        <span class="tag neutral">Memo</span>
        <h3>Senior Review Memo</h3>
        <pre class="review-output readable">${escapeHtml(memo)}</pre>
        <details class="technical-response">
          <summary>Show technical JSON</summary>
          <pre class="review-output">${escapeHtml(raw)}</pre>
        </details>
      </article>`;
    bindReviewEnhancementActions();
    return;
  }

  const fallbackMemo = jsonToReadableText(raw);
  els.results.innerHTML = `
    <article>
      <span class="tag danger">Incomplete</span>
      <h3>${escapeHtml(client)} - Tax year ${escapeHtml(taxYear)}</h3>
      <p>The backend did not return a complete senior review. Rerun after confirming the current-year return and current-year workpaper are uploaded.</p>
      ${model ? `<p>${escapeHtml(model)}</p>` : ""}
      ${renderCostSummary(payload)}
    </article>
    <article>
      <span class="tag neutral">Claude</span>
      <h3>Senior Review</h3>
      <pre class="review-output readable">${escapeHtml(fallbackMemo)}</pre>
      <details class="technical-response">
        <summary>Show technical response</summary>
        <pre class="review-output">${escapeHtml(raw)}</pre>
      </details>
    </article>`;
}
function parseStructuredReview(raw) {
  const text = String(raw || "").trim();
  const candidates = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  candidates.push(text);
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1));

  for (const candidate of candidates) {
    const cleaned = String(candidate || "").trim().replace(/^json\s*/i, "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (_) {}
    try {
      const repaired = repairJsonTextForParsing(cleaned);
      const parsed = JSON.parse(repaired);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (_) {}
  }
  return parseJsonLikeReview(text) || parsePlainTextReview(text);
}

function hasSeniorReviewSubstance(structured) {
  const hasDocs = Array.isArray(structured.documentsRead) && structured.documentsRead.length > 0;
  const hasReviewWork = Boolean(
    (Array.isArray(structured.issues) && structured.issues.length) ||
    (Array.isArray(structured.checkboxReview) && structured.checkboxReview.length) ||
    (Array.isArray(structured.tieOutResults) && structured.tieOutResults.length) ||
    structured.balanceSheetCheck ||
    (Array.isArray(structured.reviewerComments) && structured.reviewerComments.length) ||
    (Array.isArray(structured.missingDocuments) && structured.missingDocuments.length) ||
    (Array.isArray(structured.questions) && structured.questions.length) ||
    (safeText(structured.executiveSummary) && !/no executive summary provided/i.test(safeText(structured.executiveSummary)))
  );
  return hasDocs && hasReviewWork;
}

function normalizeReviewForExport(response = {}, metadata = {}) {
  const source = response?.structured || parseStructuredReview(response?.review || "") || (response?.issues || response?.executiveSummary ? response : null);
  if (!source || typeof source !== "object") return null;
  const issues = Array.isArray(source.issues) ? source.issues.map(normalizeReviewIssueForExport).filter((issue) => issue.issueDescription || issue.areaReviewed || issue.formOrSchedule) : [];
  return {
    clientName: safeText(source.clientName || metadata.entityName || metadata.clientName),
    returnType: safeText(source.returnType || metadata.returnType),
    taxYear: safeText(source.taxYear || metadata.taxYear),
    reviewStage: normalizeReviewStage(source.reviewStage || metadata.reviewStage || "Initial review"),
    generatedDate: safeText(source.generatedDate) || new Date().toLocaleDateString(),
    reviewerName: safeText(source.reviewerName || source.preparerName || metadata.preparerName),
    executiveSummary: safeText(source.executiveSummary || source.summary),
    documentsRead: normalizeDocumentsRead(source.documentsRead || source.documentSummary || source.documentsReviewed),
    feedbackApplied: normalizeReviewStringArray(source.feedbackApplied || source.firmFeedbackApplied),
    issues,
    checkboxReview: normalizeCheckboxReview(source.checkboxReview),
    tieOutResults: normalizeTieOutResults(source.tieOutResults || source.tieOuts || source.numericTieOut),
    balanceSheetCheck: normalizeBalanceSheetCheck(source.balanceSheetCheck),
    questions: normalizeReviewStringArray(source.questions || source.openQuestions),
    reviewerComments: normalizeReviewStringArray(source.reviewerComments || source.verifiedItems || source.verifiedItemsAsCorrect || source.verifiedItems),
    documentSummary: normalizeReviewStringArray(source.documentSummary || source.documentsReviewed),
    missingInformation: normalizeReviewStringArray(source.missingInformation || source.missingItems || source.missingDocuments),
    missingDocuments: normalizeReviewStringArray(source.missingDocuments || source.missingInformation || source.missingItems),
    filingReadiness: normalizeFilingReadiness(source.filingReadiness),
    overallRiskScore: safeText(source.overallRiskScore),
    finalConclusion: safeText(source.finalConclusion || source.conclusion || source.executiveSummary || source.summary),
    structuringFailed: Boolean(source.structuringFailed),
    rawReviewOutput: safeText(source.rawReviewOutput),
  };
}

function normalizeReviewIssueForExport(issue = {}) {
  return {
    priority: safePriority(issue.priority || issue.severity),
    category: safeText(issue.category),
    areaReviewed: safeText(issue.areaReviewed || issue.area || issue.category || issue.formOrSchedule || "Review item"),
    formOrSchedule: safeText(issue.formOrSchedule || issue.form || issue.schedule),
    issueDescription: safeText(issue.issueDescription || issue.description || issue.issue || issue.title || issue.detail),
    evidence: safeText(issue.evidence),
    whyItMatters: safeText(issue.whyItMatters || issue.whyItMattersText),
    riskAnalysis: safeText(issue.riskAnalysis || issue.whyItMatters || issue.whyItMattersText),
    proposedSolution: safeText(issue.proposedSolution || issue.recommendedAction || issue.recommendation || issue.action),
    recommendedAction: safeText(issue.recommendedAction || issue.proposedSolution || issue.recommendation || issue.action),
    reviewerComment: safeText(issue.reviewerComment || issue.comment),
    authority: safeText(issue.authority || issue.citation || issue.taxAuthority),
    source: stripDocumentPrefix(issue.source || issue.document || issue.reference),
    needsMoreInfo: safeText(issue.needsMoreInfo || issue.needsClientInfo || issue.missingInformation),
  };
}

function normalizeDocumentsRead(value) {
  if (!Array.isArray(value)) return normalizeReviewStringArray(value).map((summary, index) => ({ filename: `Document ${index + 1}`, role: "", summary }));
  return value.map((item, index) => {
    if (!item || typeof item !== "object") return { filename: `Document ${index + 1}`, role: "", summary: safeText(item) };
    return {
      filename: safeText(item.filename || item.name || item.document || `Document ${index + 1}`),
      role: safeText(item.role || item.type),
      summary: safeText(item.summary || item.description || item.extracted || item.notes),
    };
  }).filter((item) => item.filename || item.summary);
}

function normalizeCheckboxReview(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    box: safeText(item.box || item.checkbox || item.field),
    currentState: safeText(item.currentState || item.current || item.returnState),
    shouldBe: safeText(item.shouldBe || item.expectedState || item.correctState),
    explanation: safeText(item.explanation || item.note || item.reason),
  })).filter((item) => item.box || item.explanation);
}

function normalizeTieOutResults(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    lineItem: safeText(item.lineItem || item.line || item.description),
    returnAmount: safeText(item.returnAmount),
    workpaperAmount: safeText(item.workpaperAmount || item.sourceAmount),
    difference: safeText(item.difference),
    status: safeText(item.status || "OUT_OF_BALANCE"),
    note: safeText(item.note || item.explanation),
  })).filter((item) => item.lineItem || item.note);
}

function normalizeBalanceSheetCheck(value) {
  if (!value || typeof value !== "object") return null;
  return {
    totalAssets: safeText(value.totalAssets),
    totalLiabEquity: safeText(value.totalLiabEquity || value.totalLiabilitiesEquity),
    balanced: Boolean(value.balanced),
    difference: safeText(value.difference),
    note: safeText(value.note || value.explanation),
  };
}

function normalizeFilingReadiness(value) {
  const text = safeText(value).toUpperCase();
  if (text.includes("CONDITION")) return "READY WITH CONDITIONS";
  if (text.includes("NOT")) return "NOT READY";
  if (text.includes("READY")) return "READY";
  return "";
}

function normalizeReviewStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(cleanReviewListItem).filter(Boolean);
}

function repairJsonTextForParsing(text) {
  let output = "";
  let inString = false;
  let escaped = false;
  for (const char of String(text || "")) {
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      output += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      output += char;
      continue;
    }
    if (inString && char === "\n") {
      output += "\\n";
      continue;
    }
    if (inString && char === "\r") {
      continue;
    }
    if (inString && char === "\t") {
      output += "\\t";
      continue;
    }
    output += char;
  }
  return output.replace(/,\s*([}\]])/g, "$1");
}

function parseJsonLikeReview(text) {
  const raw = String(text || "");
  if (!/"executiveSummary"|"issues"|"documentSummary"/.test(raw)) return null;
  const executiveSummary = extractJsonLikeString(raw, "executiveSummary") || extractJsonLikeString(raw, "summary");
  const documentSummaryBlock = extractJsonLikeArrayBlock(raw, "documentSummary");
  const documentSummary = documentSummaryBlock ? extractJsonLikeArrayStrings(documentSummaryBlock) : [];
  const issuesBlock = raw.slice(Math.max(0, raw.indexOf('"issues"')));
  const issueChunks = issuesBlock.split(/\{\s*"priority"\s*:/).slice(1);
  const issues = issueChunks.map((chunk) => {
    const block = `{"priority":${chunk}`;
    return {
      priority: extractJsonLikeString(block, "priority") || "Info",
      areaReviewed: extractJsonLikeString(block, "areaReviewed"),
      formOrSchedule: extractJsonLikeString(block, "formOrSchedule"),
      issueDescription: extractJsonLikeString(block, "issueDescription"),
      evidence: extractJsonLikeString(block, "evidence"),
      whyItMatters: extractJsonLikeString(block, "whyItMatters"),
      riskAnalysis: extractJsonLikeString(block, "riskAnalysis"),
      proposedSolution: extractJsonLikeString(block, "proposedSolution"),
      recommendedAction: extractJsonLikeString(block, "recommendedAction"),
      reviewerComment: extractJsonLikeString(block, "reviewerComment"),
      source: extractJsonLikeString(block, "source"),
      needsMoreInfo: extractJsonLikeString(block, "needsMoreInfo"),
    };
  }).filter((issue) => issue.issueDescription || issue.areaReviewed || issue.formOrSchedule);
  if (!executiveSummary && !documentSummary.length && !issues.length) return null;
  return {
    executiveSummary,
    documentSummary,
    issues,
    finalConclusion: extractJsonLikeString(raw, "finalConclusion") || "",
    missingInformation: extractJsonLikeArrayStrings(extractJsonLikeArrayBlock(raw, "missingInformation") || ""),
    questions: extractJsonLikeArrayStrings(extractJsonLikeArrayBlock(raw, "questions") || ""),
    reviewerComments: extractJsonLikeArrayStrings(extractJsonLikeArrayBlock(raw, "reviewerComments") || ""),
  };
}

function extractJsonLikeString(text, key) {
  const marker = `"${key}"`;
  const start = String(text || "").indexOf(marker);
  if (start < 0) return "";
  const colon = text.indexOf(":", start + marker.length);
  if (colon < 0) return "";
  let quote = text.indexOf('"', colon + 1);
  if (quote < 0) return "";
  let output = "";
  let escaped = false;
  for (let index = quote + 1; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      output += char === "n" ? "\n" : char === "t" ? "\t" : char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') return output.trim();
    output += char;
  }
  return output.trim();
}

function extractJsonLikeArrayBlock(text, key) {
  const marker = `"${key}"`;
  const start = String(text || "").indexOf(marker);
  if (start < 0) return "";
  const open = text.indexOf("[", start + marker.length);
  if (open < 0) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(open, index + 1);
    }
  }
  return text.slice(open);
}

function extractJsonLikeArrayStrings(block) {
  const text = String(block || "");
  const values = [];
  let inString = false;
  let escaped = false;
  let current = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (!inString) {
      if (char === '"') {
        inString = true;
        current = "";
      }
      continue;
    }
    if (escaped) {
      current += char === "n" ? "\n" : char === "t" ? "\t" : char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      values.push(current.trim());
      inString = false;
      continue;
    }
    current += char;
  }
  return values.filter(Boolean);
}

function parsePlainTextReview(text) {
  const raw = String(text || "").trim();
  if (!raw || !/ISSUES|EXECUTIVE SUMMARY|FINAL CONCLUSION/i.test(raw)) return null;
  const section = (name, nextNames = []) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const next = nextNames.length ? `(?=${nextNames.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}|$)` : "$";
    const match = raw.match(new RegExp(`${escaped}\\s*-*\\s*([\\s\\S]*?)${next}`, "i"));
    return match ? match[1].trim() : "";
  };
  const headers = ["ISSUES & ITEMS TO REVIEW", "OPEN QUESTIONS", "CHECKLIST - ITEMS VERIFIED AS CORRECT", "DOCUMENTS REVIEWED", "MISSING INFORMATION", "FINAL CONCLUSION"];
  const executiveSummary = section("EXECUTIVE SUMMARY", headers);
  const issuesText = section("ISSUES & ITEMS TO REVIEW", headers.slice(1));
  const issues = parsePlainTextIssues(issuesText);
  const questions = parsePlainTextList(section("OPEN QUESTIONS", headers.slice(2)));
  const reviewerComments = parsePlainTextList(section("CHECKLIST - ITEMS VERIFIED AS CORRECT", headers.slice(3)));
  const documentSummary = parsePlainTextList(section("DOCUMENTS REVIEWED", headers.slice(4)));
  const missingInformation = parsePlainTextList(section("MISSING INFORMATION", headers.slice(5)));
  const finalConclusion = section("FINAL CONCLUSION");
  if (!executiveSummary && !issues.length && !documentSummary.length && !finalConclusion) return null;
  return { executiveSummary, issues, questions, reviewerComments, documentSummary, missingInformation, finalConclusion };
}

function parsePlainTextIssues(text) {
  const chunks = String(text || "").split(/(?=\n?(?:Issue\s+\d+\s*:)?\s*(?:[-*•]\s*)?\[(?:HIGH|MEDIUM|LOW|INFO)\])/i).map((item) => item.trim()).filter(Boolean);
  return chunks.map((chunk) => {
    const firstLine = chunk.split(/\r?\n/)[0] || "";
    const heading = firstLine.match(/\[(HIGH|MEDIUM|LOW|INFO)\]\s*(?:[-—:]\s*)?(.*)$/i);
    const issue = {
      priority: heading?.[1] || "Info",
      areaReviewed: heading?.[2] || "",
      formOrSchedule: "",
      issueDescription: "",
      evidence: "",
      whyItMatters: "",
      recommendedAction: "",
      reviewerComment: "",
      source: "",
      needsMoreInfo: "",
    };
    const body = chunk.split(/\r?\n/).slice(1).join("\n");
    issue.formOrSchedule = extractPlainLabel(body, ["Form / Schedule", "Form or schedule", "Form"]);
    issue.issueDescription = extractPlainLabel(body, ["Issue", "Description"]) || (heading?.[2] || "");
    issue.evidence = extractPlainLabel(body, ["Evidence"]);
    issue.whyItMatters = extractPlainLabel(body, ["Why It Matters", "Why it matters"]);
    issue.recommendedAction = extractPlainLabel(body, ["Recommended Action", "Recommended action"]);
    issue.reviewerComment = extractPlainLabel(body, ["Reviewer Comment", "Reviewer comment"]);
    issue.source = extractPlainLabel(body, ["Source"]);
    issue.needsMoreInfo = extractPlainLabel(body, ["Needs More Info", "Needs more info"]);
    return issue;
  }).filter((issue) => issue.issueDescription || issue.areaReviewed);
}

function extractPlainLabel(text, labels) {
  const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const nextLabel = "(?:Form \\/ Schedule|Form or schedule|Form|Issue|Description|Evidence|Why It Matters|Why it matters|Recommended Action|Recommended action|Reviewer Comment|Reviewer comment|Source|Needs More Info|Needs more info)";
  const match = String(text || "").match(new RegExp(`(?:^|\\n)\\s*(?:${labelPattern})\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*${nextLabel}\\s*:|$)`, "i"));
  return match ? match[1].trim() : "";
}

function parsePlainTextList(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+\.)\s*/, "").replace(/^\[[A-Z ]+\]\s*/, "").trim())
    .filter((line) => line && !/^-+$/.test(line) && !/^none noted\.?$/i.test(line));
}

function jsonToReadableText(raw) {
  const structured = parseStructuredReview(raw);
  if (!structured) return raw || "";
  return toCleanWrittenReview({ structured }, {
    clientName: document.getElementById("clientName").value.trim(),
    entityName: document.getElementById("entityName").value.trim(),
    taxYear: document.getElementById("taxYear").value.trim(),
    returnType: document.getElementById("returnType").value,
  });
}

function renderDocumentSummary(summary) {
  if (!summary) return "";
  const rows = Array.isArray(summary) ? summary : Object.entries(summary).map(([key, value]) => `${key}: ${value}`);
  return renderStringList("Documents Reviewed", rows);
}

function readinessTagClass(readiness) {
  const text = safeText(readiness).toUpperCase();
  if (text.includes("NOT")) return "danger";
  if (text.includes("CONDITION")) return "warning";
  if (text.includes("READY")) return "success";
  return "neutral";
}

function renderDocumentsReadSection(documents) {
  if (!Array.isArray(documents) || !documents.length) return "";
  return `
    <article>
      <span class="tag neutral">Documents</span>
      <h3>Documents Read</h3>
      <ul class="result-list">${documents.map((doc) => `<li><strong>${escapeHtml(doc.filename || "Document")}</strong>${doc.role ? ` - ${escapeHtml(doc.role)}` : ""}: ${escapeHtml(doc.summary || "Read for review.")}</li>`).join("")}</ul>
    </article>`;
}

function renderFeedbackAppliedSection(items) {
  if (!Array.isArray(items) || !items.length) return "";
  return renderStringList("Firm Review Feedback Applied", items);
}

function renderCheckboxReviewSection(rows) {
  if (!Array.isArray(rows) || !rows.length) return "";
  return renderReviewTable("Checkbox Review", ["Box", "Current State", "Should Be", "Explanation"], rows.map((row) => [row.box, row.currentState, row.shouldBe, row.explanation]));
}

function renderTieOutSection(rows) {
  if (!Array.isArray(rows) || !rows.length) return "";
  return renderReviewTable("Numeric Tie-Out", ["Line Item", "Return", "Workpaper", "Difference", "Status", "Note"], rows.map((row) => [row.lineItem, row.returnAmount, row.workpaperAmount, row.difference, row.status, row.note]), (row) => safeText(row.status).toUpperCase().includes("OUT") ? "danger-row" : "");
}

function renderBalanceSheetCheckSection(check) {
  if (!check) return "";
  const status = check.balanced ? "BALANCED" : `OUT OF BALANCE${check.difference ? ` by ${check.difference}` : ""}`;
  return `
    <article>
      <span class="tag ${check.balanced ? "success" : "danger"}">Schedule L</span>
      <h3>Balance Sheet Check</h3>
      <p><strong>Total Assets:</strong> ${escapeHtml(check.totalAssets || "Not provided")} | <strong>Total Liabilities & Equity:</strong> ${escapeHtml(check.totalLiabEquity || "Not provided")} | <strong>${escapeHtml(status)}</strong></p>
      ${check.note ? `<p>${escapeHtml(check.note)}</p>` : ""}
    </article>`;
}

function renderReviewTable(title, headers, rows, rowClassFn = null) {
  return `
    <article>
      <span class="tag neutral">Review Detail</span>
      <h3>${escapeHtml(title)}</h3>
      <div class="table-scroll">
        <table class="review-detail-table">
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
          <tbody>${rows.map((row) => `<tr class="${rowClassFn ? escapeHtml(rowClassFn({ status: row[4], row })) : ""}">${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
    </article>`;
}

function renderIssueSection(title, issues) {
  if (!issues.length) return "";
  return `
    <article>
      <span class="tag warning">Findings</span>
      <h3>${escapeHtml(title)} (${issues.length})</h3>
      <div class="issue-stack">${issues.map((issue, index) => renderIssueCard(issue, index)).join("")}</div>
    </article>`;
}

function renderIssueSummarySection(issues = []) {
  const summaryLines = buildIssueSummaryLines(issues);
  if (!summaryLines.length) return "";
  return `
    <article>
      <span class="tag warning">Summary</span>
      <h3>Issues & Items to Review Summary</h3>
      <ul class="issue-summary-list">
        ${summaryLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
      </ul>
    </article>`;
}

function renderResolutionSummary(structured, metadata) {
  const issues = Array.isArray(structured.issues) ? structured.issues : [];
  const resolved = issues.filter((_, index) => issueResolutionState[index]?.status === "resolved").length;
  const highRemaining = issues.filter((issue, index) => normalizedPriority(issue) === "high" && issueResolutionState[index]?.status !== "resolved").length;
  const percent = issues.length ? Math.round((resolved / issues.length) * 100) : 0;
  const risk = calculateAuditRisk(structured);
  return `
    <article class="resolution-summary">
      <div class="resolution-summary-header">
        <div>
          <span class="tag neutral">Resolution Tracking</span>
          <h3>${resolved} of ${issues.length} issues resolved | ${highRemaining} HIGH issues remaining</h3>
        </div>
        <button id="downloadResolutionReport" class="primary-button small-button" type="button">Resolution Report</button>
      </div>
      <div class="resolution-progress" aria-label="Issue resolution progress"><span style="width: ${percent}%"></span></div>
      <div class="audit-risk ${risk.className}">
        <strong>Audit Risk Indicator: ${risk.label} (${risk.score})</strong>
        <p>${escapeHtml(risk.explanation)}</p>
      </div>
    </article>`;
}

function renderIssueCard(issue, index) {
  const priority = normalizedPriority(issue);
  const priorityClass = priority === "high" ? "danger" : priority === "medium" ? "warning" : priority === "low" ? "neutral" : "success";
  const resolution = issueResolutionState[index] || { status: "open" };
  const isResolved = resolution.status === "resolved";
  const statusLabel = isResolved ? "RESOLVED" : resolution.status === "responded" ? "RESPONDED" : "OPEN";
  const formName = issue.formOrSchedule || issue.form || issue.schedule || "";
  return `
    <div class="issue-card ${priority} ${isResolved ? "resolved" : ""}" data-issue-card="${index}">
      <div class="issue-heading">
        <span class="tag ${isResolved ? "success" : priorityClass}">${escapeHtml(isResolved ? "RESOLVED" : issue.priority || issue.severity || "Info")}</span>
        <strong>${escapeHtml(issue.areaReviewed || issue.category || "Review Area")}</strong>
        <span class="issue-status ${resolution.status || "open"}">${escapeHtml(statusLabel)}</span>
      </div>
      <dl>
        ${renderDefinition("Form or schedule", issue.formOrSchedule)}
        ${renderDefinition("Issue", issue.issueDescription || issue.title || issue.detail)}
        ${renderDefinition("Evidence", issue.evidence)}
        ${renderDefinition("Risk analysis", issue.riskAnalysis || issue.whyItMatters)}
        ${renderDefinition("Proposed solution", issue.proposedSolution || issue.recommendedAction || issue.recommendation)}
        ${renderDefinition("Reviewer comment", issue.reviewerComment)}
        ${renderDefinition("Source", issue.source)}
        ${renderDefinition("Needs more info?", issue.needsMoreInfo)}
      </dl>
      ${formName ? `<button class="irs-link-button" type="button" data-irs-form="${escapeHtml(formName)}">View IRS Instructions for ${escapeHtml(formName)}</button>` : ""}
      <details class="preparer-response-panel">
        <summary>Add Response / Resolution</summary>
        <label>
          <span>Your response or explanation for this issue</span>
          <textarea rows="4" data-issue-response="${index}" placeholder="Explain the treatment, upload support if needed, and submit for reviewer re-evaluation.">${escapeHtml(resolution.response || "")}</textarea>
        </label>
        <label class="mini-upload">
          <input type="file" multiple data-issue-files="${index}" />
          Upload supporting document (optional)
        </label>
        <div class="issue-response-actions">
          <button class="primary-button small-button" type="button" data-submit-issue-response="${index}">Submit Response</button>
          <span class="issue-response-status ${resolution.status || "open"}">${escapeHtml(statusLabel)}</span>
        </div>
        ${resolution.evaluation ? renderIssueEvaluation(resolution.evaluation) : ""}
      </details>
    </div>`;
}

function renderIssueEvaluation(evaluation) {
  const resolved = Boolean(evaluation.resolved);
  return `
    <div class="issue-evaluation ${resolved ? "resolved" : "follow-up"}">
      <strong>${resolved ? "Resolved" : "Follow-up required"}</strong>
      <p>${escapeHtml(evaluation.resolution || "Claude did not return a resolution note.")}</p>
      ${!resolved && evaluation.followUpQuestion ? `<p class="follow-up-question">${escapeHtml(evaluation.followUpQuestion)}</p>` : ""}
      ${renderCostSummary(evaluation)}
    </div>`;
}

function renderEfileDiagnosticsCta(structured, metadata) {
  const issues = getEfileIssues(structured);
  if (!issues.length) return "";
  return `
    <article class="efile-diagnostics-cta">
      <span class="tag warning">E-file Errors?</span>
      <h3>Run Diagnostics</h3>
      <p>${issues.length} issue${issues.length === 1 ? "" : "s"} mention e-file diagnostics, rejects, or software errors.</p>
      <button id="prefillDiagnosticsFromReview" class="primary-button small-button" type="button">Analyze E-File Errors</button>
    </article>`;
}

function getEfileIssues(structured) {
  const keywords = ["e-file", "efile", "diagnostic", "ref #", "reject", "error"];
  return (structured.issues || []).filter((issue) => {
    const text = JSON.stringify(issue).toLowerCase();
    return keywords.some((keyword) => text.includes(keyword));
  });
}

function prefillDiagnosticsFromReview() {
  if (!lastReview?.response?.structured) return;
  const metadata = lastReview.payload.metadata || {};
  const issues = getEfileIssues(lastReview.response.structured).filter((issue) => normalizedPriority(issue) === "high");
  const sourceIssues = issues.length ? issues : getEfileIssues(lastReview.response.structured);
  els.diagnosticsReturnType.value = metadata.returnType || "";
  els.diagnosticsTaxYear.value = metadata.taxYear || els.diagnosticsTaxYear.value;
  els.diagnosticsErrorText.value = sourceIssues.map((issue, index) => `${index + 1}. ${issue.formOrSchedule || issue.areaReviewed || "Review issue"}: ${issue.issueDescription || issue.title || issue.detail || ""}\nEvidence: ${issue.evidence || ""}\nRecommended action: ${issue.recommendedAction || issue.recommendation || ""}`).join("\n\n");
  updateDiagnosticsReadyState();
  setWorkspaceMode("diagnostics");
  els.diagnosticsErrorText.focus();
}

function bindReviewEnhancementActions() {
  document.querySelectorAll("[data-submit-issue-response]").forEach((button) => {
    button.addEventListener("click", () => submitIssueResponse(Number(button.dataset.submitIssueResponse)));
  });
  document.querySelectorAll("[data-irs-form]").forEach((button) => {
    button.addEventListener("click", () => openIrsInstructions(button.dataset.irsForm));
  });
  const reportButton = document.getElementById("downloadResolutionReport");
  if (reportButton) reportButton.addEventListener("click", downloadResolutionReport);
  document.getElementById("prefillDiagnosticsFromReview")?.addEventListener("click", prefillDiagnosticsFromReview);
}

async function submitIssueResponse(issueIndex) {
  if (!lastReview?.response?.structured?.issues?.[issueIndex]) return;
  const textarea = document.querySelector(`[data-issue-response="${issueIndex}"]`);
  const fileInput = document.querySelector(`[data-issue-files="${issueIndex}"]`);
  const preparerResponse = String(textarea?.value || "").trim();
  if (!preparerResponse) {
    textarea?.focus();
    return;
  }

  const button = document.querySelector(`[data-submit-issue-response="${issueIndex}"]`);
  if (button) button.disabled = true;
  try {
    const additionalFiles = [];
    for (const file of Array.from(fileInput?.files || [])) {
      additionalFiles.push(await prepareFileForReview({ file, type: "issueResponse" }));
    }
    issueResolutionState[issueIndex] = { ...(issueResolutionState[issueIndex] || {}), status: "responded", response: preparerResponse };
    const response = await runWithCostEstimate("review", {
      returnType: lastReview.payload?.metadata?.returnType || "",
      hasWorkpaper: Boolean(additionalFiles.length),
    }, () => fetch(`${API_BASE_URL}/api/review/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        originalReview: lastReview.response,
        issueIndex,
        preparerResponse,
        additionalFiles,
      }),
    }));
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Backend returned ${response.status}`);
    issueResolutionState[issueIndex] = {
      response: preparerResponse,
      status: result.resolved ? "resolved" : "responded",
      evaluation: result,
      updatedAt: new Date().toISOString(),
    };
    lastReview.response.issueResponses = issueResolutionState;
    await autosaveSession({ reviewResult: lastReview.response });
    renderReviewResult(lastReview.response, lastReview.payload.metadata);
  } catch (error) {
    issueResolutionState[issueIndex] = {
      ...(issueResolutionState[issueIndex] || {}),
      status: "responded",
      evaluation: { resolved: false, resolution: error.message || "The response could not be evaluated.", followUpRequired: true, followUpQuestion: "Try again after the backend is available." },
    };
    lastReview.response.issueResponses = issueResolutionState;
    renderReviewResult(lastReview.response, lastReview.payload.metadata);
  } finally {
    if (button) button.disabled = false;
  }
}

async function openIrsInstructions(formName) {
  const year = lastReview?.payload?.metadata?.taxYear || document.getElementById("taxYear").value.trim() || new Date().getFullYear();
  const response = await fetch(`${API_BASE_URL}/api/irs-instructions?form=${encodeURIComponent(formName)}&year=${encodeURIComponent(year)}`);
  const payload = await response.json().catch(() => ({}));
  if (response.ok && payload.url) {
    window.open(payload.url, "_blank", "noopener");
    return;
  }
  window.alert(payload.error || "No IRS instructions link was found for this issue.");
}

function calculateAuditRisk(structured) {
  const issues = Array.isArray(structured.issues) ? structured.issues : [];
  let score = 0;
  const drivers = [];
  issues.forEach((issue, index) => {
    if (issueResolutionState[index]?.status === "resolved") return;
    const priority = normalizedPriority(issue);
    const text = JSON.stringify(issue).toLowerCase();
    if (priority === "high") { score += 3; drivers.push("high-priority issues"); }
    else if (priority === "medium") { score += 1; drivers.push("medium-priority issues"); }
    if (text.includes("balance sheet") && (text.includes("out of balance") || text.includes("not balanced"))) { score += 5; drivers.push("balance sheet imbalance"); }
    if (text.includes("missing schedule") || text.includes("schedule missing")) { score += 4; drivers.push("missing schedules"); }
    if ((text.includes("variance") || text.includes("year-over-year") || text.includes("revenue")) && (text.includes(">20") || text.includes("20%") || text.includes("large"))) {
      score += 2;
      drivers.push("large year-over-year variance");
    }
  });
  const unanswered = Array.isArray(structured.questions) ? structured.questions.length : 0;
  if (unanswered) {
    score += unanswered * 2;
    drivers.push("unanswered questions");
  }
  const level = score <= 3
    ? { label: "LOW RISK", className: "low" }
    : score <= 8
      ? { label: "MODERATE RISK", className: "moderate" }
      : score <= 15
        ? { label: "ELEVATED RISK", className: "elevated" }
        : { label: "HIGH AUDIT RISK", className: "high" };
  const uniqueDrivers = [...new Set(drivers)].slice(0, 3);
  return {
    ...level,
    score,
    explanation: uniqueDrivers.length ? `Driven mainly by ${uniqueDrivers.join(", ")}.` : "No material unresolved risk drivers were detected.",
  };
}

async function downloadResolutionReport() {
  if (!lastReview) return;
  const metadata = lastReview.payload.metadata;
  const structured = lastReview.response.structured || {};
  const lines = [
    `Resolution Report - ${safeText(metadata.entityName || metadata.clientName) || "Client"} ${safeText(metadata.taxYear)}`,
    "",
    "SUMMARY",
    "-------",
    resolutionReportSummary(structured),
    "",
    "ISSUES",
    "------",
  ];
  (structured.issues || []).map(sanitizeIssue).forEach((issue, index) => {
    const state = issueResolutionState[index] || { status: "open" };
    lines.push(
      `${index + 1}. [${safeStatus(state.status || "open").toUpperCase()}] ${issue.area}`,
      `Original issue: ${issue.description}`,
      `Preparer response: ${safeText(state.response) || "No response submitted."}`,
      `Resolution: ${safeText(state.evaluation?.resolution) || "Not evaluated yet."}`,
      state.evaluation?.followUpQuestion ? `Remaining open item: ${safeText(state.evaluation.followUpQuestion)}` : "",
      ""
    );
  });
  const fileName = `${metadata.entityName || metadata.clientName || "tax-review"}-${metadata.taxYear || "year"}-resolution-report.docx`.replace(/[^a-z0-9.-]+/gi, "-");
  await downloadWordDocument(fileName, lines.filter(Boolean).join("\n"));
}

function resolutionReportSummary(structured) {
  const issues = Array.isArray(structured.issues) ? structured.issues : [];
  const resolved = issues.filter((_, index) => issueResolutionState[index]?.status === "resolved").length;
  const highRemaining = issues.filter((issue, index) => normalizedPriority(issue) === "high" && issueResolutionState[index]?.status !== "resolved").length;
  return `${resolved} of ${issues.length} issues resolved. ${highRemaining} high-priority issues remain open.`;
}

function renderDefinition(label, value) {
  if (!value) return "";
  return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
}

function renderStringList(title, items) {
  if (!Array.isArray(items) || !items.length) return "";
  return `
    <article>
      <span class="tag neutral">Review</span>
      <h3>${escapeHtml(title)}</h3>
      <ul class="result-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </article>`;
}

function renderCostSummary(payload) {
  return "";
}

function renderMessage(type, title, message) {
  const tagClass = type === "warning" ? "warning" : "neutral";
  els.results.innerHTML = `
    <article>
      <span class="tag ${tagClass}">${type === "warning" ? "Attention" : "Info"}</span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
    </article>`;
}

async function downloadReview(type) {
  if (!lastReview) return;
  const metadata = lastReview.payload.metadata;
  lastReview.response.structured = normalizeReviewForExport(lastReview.response, metadata);
  const baseName = `${metadata.entityName || metadata.clientName || "tax-review"}-${metadata.taxYear || "year"}`.replace(/[^a-z0-9-]+/gi, "-");
  if (type === "word") {
    await downloadWordDocument(`${baseName}.docx`, toCleanWrittenReview(lastReview.response, metadata));
  } else if (type === "text") {
    downloadBlob(`${baseName}.txt`, toCleanWrittenReview(lastReview.response, metadata), "text/plain;charset=utf-8");
  }
}

function toCleanWrittenReview(response, metadata = {}) {
  const structured = normalizeReviewForExport(response, metadata);
  if (!structured) return safeText(response?.review) || "";
  const lines = [
    "RAG Tax AI",
    "Senior Tax Return Review",
    "",
    `Client: ${safeText(metadata.entityName || metadata.clientName) || "Client not specified"}`,
    `Return Type: ${safeText(metadata.returnType) || "Not specified"}`,
    `Tax Year: ${safeText(metadata.taxYear) || "Not specified"}`,
    `Review Stage: ${normalizeReviewStage(metadata.reviewStage || "Initial review")}`,
    structured.reviewerName ? `Reviewer: ${safeText(structured.reviewerName)}` : "",
    `Generated: ${new Date().toLocaleDateString()}`,
    "",
    "EXECUTIVE SUMMARY",
    "-----------------",
    safeText(structured.executiveSummary) || "No executive summary provided.",
    "",
    "FILING READINESS",
    "----------------",
    `${safeText(structured.filingReadiness) || "Not specified"}${structured.overallRiskScore ? ` | Overall Risk Score: ${safeText(structured.overallRiskScore)}` : ""}`,
    "",
    "DOCUMENTS READ",
    "--------------",
    ...(structured.documentsRead?.length ? structured.documentsRead.map((doc) => `- ${safeText(doc.filename)}${doc.role ? ` - ${safeText(doc.role)}` : ""}: ${safeText(doc.summary)}`) : ["- None noted."]),
    "",
    "FIRM REVIEW FEEDBACK APPLIED",
    "----------------------------",
    ...(structured.feedbackApplied?.length ? structured.feedbackApplied.map((item) => `- ${safeText(item)}`) : ["- None noted."]),
    "",
    "ISSUES & ITEMS TO REVIEW SUMMARY",
    "--------------------------------",
    ...(() => {
      const summaryLines = buildIssueSummaryLines(structured.issues);
      return summaryLines.length ? summaryLines.map((line) => `- ${line}`) : ["- No issues identified in the structured review."];
    })(),
    "",
    "ISSUES & ITEMS TO REVIEW",
    "------------------------",
  ];

  const issues = [...(structured.issues || [])].map(sanitizeIssue).sort((a, b) => priorityRank(a) - priorityRank(b));
  if (issues.length) {
    issues.forEach((issue, index) => {
      lines.push(`Issue ${index + 1}: [${issue.priority}] ${issue.area}`);
      lines.push(`Issue: ${issue.description}`);
      if (issue.evidence) lines.push(`Evidence: ${issue.evidence}`);
      if (issue.riskAnalysis || issue.whyItMatters) lines.push(`Risk analysis: ${issue.riskAnalysis || issue.whyItMatters}`);
      if (issue.proposedSolution || issue.recommendedAction) lines.push(`Proposed solution: ${issue.proposedSolution || issue.recommendedAction}`);
      if (issue.reviewerComment) lines.push(`Reviewer comment: ${issue.reviewerComment}`);
      if (issue.authority) lines.push(`Authority: ${issue.authority}`);
      if (issue.source) lines.push(`Source: ${issue.source}`);
      if (issue.needsMoreInfo) lines.push(`Needs more info: ${issue.needsMoreInfo}`);
      lines.push("");
    });
  } else {
    if (structured.rawFallback) {
      lines.push("Automatic structuring failed. Raw review output follows:", "");
      lines.push(safeText(structured.rawFallback), "");
    } else {
      lines.push("- No issues identified in the structured review.", "");
    }
  }

  addCheckboxReviewText(lines, structured.checkboxReview);
  addTieOutText(lines, structured.tieOutResults);
  addBalanceSheetCheckText(lines, structured.balanceSheetCheck);
  addCleanPlainList(lines, structured.questions, "QUESTION");
  addCleanPlainList(lines, structured.reviewerComments, "VERIFIED");
  addCleanPlainList(lines, structured.missingDocuments || structured.missingInformation, "MISSING");
  lines.push("", "FINAL CONCLUSION", "----------------");
  lines.push(safeText(structured.finalConclusion || structured.executiveSummary) || "Review complete.");
  if (structured.structuringFailed && structured.rawReviewOutput) {
    lines.push("", "RAW MODEL OUTPUT SAVED", "----------------------");
    lines.push("Automatic structuring failed. The raw Claude output is included below so the review content is not lost.");
    lines.push(safeText(structured.rawReviewOutput));
  }
  return lines.filter((line) => line !== null && line !== undefined).map(safeText).join("\n");
}

function addCheckboxReviewText(lines, rows) {
  lines.push("", "CHECKBOX REVIEW", "---------------");
  if (!Array.isArray(rows) || !rows.length) {
    lines.push("- None noted.");
    return;
  }
  rows.forEach((row) => lines.push(`- ${safeText(row.box)} | Current: ${safeText(row.currentState)} | Should be: ${safeText(row.shouldBe)} | ${safeText(row.explanation)}`));
}

function addTieOutText(lines, rows) {
  lines.push("", "NUMERIC TIE-OUT", "---------------");
  if (!Array.isArray(rows) || !rows.length) {
    lines.push("- None noted.");
    return;
  }
  rows.forEach((row) => lines.push(`- ${safeText(row.lineItem)} | Return: ${safeText(row.returnAmount)} | Workpaper: ${safeText(row.workpaperAmount)} | Difference: ${safeText(row.difference)} | Status: ${safeText(row.status)}${row.note ? ` | ${safeText(row.note)}` : ""}`));
}

function addBalanceSheetCheckText(lines, check) {
  lines.push("", "BALANCE SHEET CHECK", "-------------------");
  if (!check) {
    lines.push("- None noted.");
    return;
  }
  lines.push(`Total Assets: ${safeText(check.totalAssets)} | Total Liabilities & Equity: ${safeText(check.totalLiabEquity)} | ${check.balanced ? "BALANCED" : `OUT OF BALANCE by ${safeText(check.difference)}`}`);
  if (check.note) lines.push(safeText(check.note));
}

function addCleanPlainList(lines, items, label) {
  lines.push("", label === "QUESTION" ? "OPEN QUESTIONS" : label === "VERIFIED" ? "CHECKLIST - ITEMS VERIFIED AS CORRECT" : label === "DOCUMENT" ? "DOCUMENTS REVIEWED" : "MISSING INFORMATION");
  lines.push("-".repeat(lines[lines.length - 1].length));
  const cleanItems = Array.isArray(items) ? items.map(cleanReviewListItem).filter(Boolean) : [];
  if (!cleanItems.length) {
    lines.push(`- [${label}] None noted.`);
    return;
  }
  cleanItems.forEach((item) => lines.push(`- [${label}] ${item}`));
}

function cleanReviewListItem(item) {
  if (item === null || item === undefined) return "";
  if (typeof item !== "object") return stripDocumentPrefix(item);
  const preferred = item.question || item.comment || item.summary || item.description || item.item || item.document || item.name || item.title || item.missingItem || item.action;
  if (preferred) return stripDocumentPrefix(preferred);
  return Object.entries(item)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim())
    .map(([key, value]) => `${key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ")}: ${safeText(value)}`)
    .join("; ");
}

function toWrittenReview(response, metadata) {
  return toCleanWrittenReview(response, metadata);
}

function addPlainList(lines, items, label) {
  if (!Array.isArray(items) || !items.length) {
    lines.push(`- [${label}] None noted.`);
    return;
  }
  items.forEach((item) => lines.push(`- [${label}] ${cleanReviewListItem(item)}`));
}

function priorityRank(issue) {
  return { high: 0, medium: 1, low: 2, info: 3 }[normalizedPriority(issue)] ?? 4;
}

async function downloadWordDocument(fileName, reviewText) {
  const blob = await createDocxBlob(cleanDocumentDownloadText(reviewText));
  downloadBlob(fileName, blob, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
}

function cleanDocumentDownloadText(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  if (!/^[{\[]/.test(candidate)) return raw;
  try {
    return jsonToReadableDocument(JSON.parse(candidate));
  } catch {
    return raw;
  }
}

function jsonToReadableDocument(value, title = "AI Generated Document", depth = 0) {
  const lines = [];
  if (depth === 0) lines.push(title.toUpperCase(), "");
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (item && typeof item === "object") {
        lines.push(`${index + 1}.`);
        lines.push(jsonToReadableDocument(item, "", depth + 1));
      } else {
        lines.push(`- ${String(item ?? "")}`);
      }
    });
    return lines.filter(Boolean).join("\n");
  }
  if (!value || typeof value !== "object") return String(value ?? "");
  Object.entries(value).forEach(([key, item]) => {
    const label = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
    if (Array.isArray(item)) {
      lines.push(label.toUpperCase());
      item.forEach((entry) => {
        const entryText = entry && typeof entry === "object" ? jsonToReadableDocument(entry, "", depth + 1) : String(entry ?? "");
        lines.push(entryText.includes("\n") ? entryText : `- ${entryText}`);
      });
      lines.push("");
    } else if (item && typeof item === "object") {
      lines.push(label.toUpperCase());
      lines.push(jsonToReadableDocument(item, "", depth + 1), "");
    } else if (item !== null && item !== undefined && String(item).trim()) {
      lines.push(`${label}: ${String(item)}`);
    }
  });
  return lines.filter((line) => line !== null && line !== undefined).join("\n");
}

function toMarkdown(response, metadata) {
  const structured = normalizeReviewForExport(response, metadata);
  if (!structured) return response.review || "";
  const lines = [
    `# AI Senior Tax Review - ${metadata.entityName || metadata.clientName || "Unnamed client"}`,
    "",
    `Tax year: ${metadata.taxYear || "Not specified"}`,
    `Return type: ${metadata.returnType || "Not specified"}`,
    `States included: ${metadata.statesIncluded || "Not specified"}`,
    "",
    "## Executive Summary",
    structured.executiveSummary || structured.summary || "",
    "",
    "## Issues",
  ];

  (structured.issues || []).forEach((issue, index) => {
    lines.push(
      "",
      `### ${index + 1}. ${issue.areaReviewed || issue.category || "Review Area"} - ${issue.priority || issue.severity || "Info"}`,
      `- Form or schedule: ${issue.formOrSchedule || "N/A"}`,
      `- Issue: ${issue.issueDescription || issue.title || issue.detail || "N/A"}`,
      `- Evidence: ${issue.evidence || "N/A"}`,
      `- Why it matters: ${issue.whyItMatters || "N/A"}`,
      `- Recommended action: ${issue.recommendedAction || issue.recommendation || "N/A"}`,
      `- Reviewer comment: ${issue.reviewerComment || "N/A"}`,
      `- Source: ${issue.source || "N/A"}`,
      `- Needs more info: ${issue.needsMoreInfo || "N/A"}`
    );
  });

  addMarkdownList(lines, "Missing Information", structured.missingInformation);
  addMarkdownList(lines, "Reviewer Comments", structured.reviewerComments);
  addMarkdownList(lines, "Open Questions", structured.questions);
  lines.push("", "## Final Conclusion", structured.finalConclusion || "");
  return lines.join("\n");
}

function addMarkdownList(lines, title, items) {
  if (!Array.isArray(items) || !items.length) return;
  lines.push("", `## ${title}`);
  items.forEach((item) => lines.push(`- ${item}`));
}

async function createDocxBlob(reviewText) {
  const JSZip = window.JSZip;
  if (!JSZip) throw new Error("DOCX engine is not loaded.");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`);
  zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
  zip.folder("docProps").file("core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Senior Tax Review</dc:title>
  <dc:creator>RAG Tax AI</dc:creator>
  <cp:lastModifiedBy>RAG Tax AI</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`);
  zip.folder("docProps").file("app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>RAG Tax AI</Application>
</Properties>`);
  zip.folder("word").file("document.xml", buildDocxDocumentXml(reviewText));
  zip.folder("word").folder("_rels").file("document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

function buildDocxDocumentXml(reviewText) {
  const paragraphs = String(reviewText || "")
    .split(/\r?\n/)
    .map((line) => buildDocxParagraph(line));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.join("\n")}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

function buildDocxParagraph(line) {
  const text = String(line || "");
  const isHeading = text && text === text.toUpperCase() && !text.startsWith("â€¢") && text.length < 80;
  const isDivider = /^-+$/.test(text.trim());
  if (isDivider) return "";
  const style = isHeading
    ? '<w:pPr><w:spacing w:before="260" w:after="120"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:pPr>'
    : '<w:pPr><w:spacing w:after="120"/><w:rPr><w:sz w:val="22"/></w:rPr></w:pPr>';
  return `<w:p>${style}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function escapeXml(value) {
  return String(value || "").replace(/[<>&'"]/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  })[char]);
}

function downloadBlob(fileName, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function resetFiles() {
  Object.keys(filesByType).forEach((type) => {
    filesByType[type] = [];
    fileInputs[type].value = "";
  });
  taxReturnRoles.clear();
  lastReview = null;
  lastDeliverableOutput = null;
  els.exportActions.hidden = true;
  els.progressList.hidden = true;
  els.reviewStatus.textContent = "Ready";
  refreshDeliverableStatus();
  renderFiles();
  renderValidation(validateBeforeReview({ showWarnings: true }));
  els.results.innerHTML = `
    <article>
      <span class="tag neutral">Pending</span>
      <h3>Waiting for documents</h3>
      <p>Results will appear here with priority, evidence, source, recommended action, and reviewer comments.</p>
    </article>`;
}

function setRunningState(isRunning) {
  els.runReview.disabled = isRunning;
  els.clearFiles.disabled = isRunning;
  els.reviewStatus.textContent = isRunning ? "Running" : els.reviewStatus.textContent;
  els.runHint.textContent = isRunning ? "Please keep this tab open while Claude reviews the file package." : "The app will validate files, send grouped documents to the backend, and display a structured review.";
}

function updateStepper() {
  const hasClientContext = Boolean(
    document.getElementById("clientName").value.trim() ||
    document.getElementById("entityName").value.trim() ||
    document.getElementById("statesIncluded").value.trim()
  );
  const hasFiles = getAllFiles().length > 0;
  const hasNotes = Boolean(document.getElementById("userNotes").value.trim() || serverConfig.masterPromptConfigured);
  const hasReview = Boolean(lastReview);

  setStepCompleted("stepClient", hasClientContext);
  setStepCompleted("stepFiles", hasFiles);
  setStepCompleted("stepNotes", hasNotes);
  setStepCompleted("stepReview", hasReview);
}

function setStepCompleted(id, completed) {
  const step = document.getElementById(id);
  step.classList.toggle("completed", completed);
}

function setActiveStep(id) {
  ["stepClient", "stepFiles", "stepNotes", "stepReview"].forEach((stepId) => {
    document.getElementById(stepId).classList.toggle("active", stepId === id);
  });
}

function setupStepNavigation() {
  const stepMap = [
    ["stepClient", "clientSection"],
    ["stepFiles", "uploadSection"],
    ["stepNotes", "instructionsSection"],
    ["stepReview", "runSection"],
  ];

  stepMap.forEach(([stepId, sectionId]) => {
    const step = document.getElementById(stepId);
    step.addEventListener("click", () => {
      setActiveStep(stepId);
      document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  const updateFromScroll = () => {
    const marker = window.innerHeight * 0.32;
    let activeStep = stepMap[0][0];

    stepMap.forEach(([stepId, sectionId]) => {
      const section = document.getElementById(sectionId);
      if (!section) return;
      const rect = section.getBoundingClientRect();
      if (rect.top <= marker) activeStep = stepId;
    });

    setActiveStep(activeStep);
  };

  window.addEventListener("scroll", throttle(updateFromScroll, 80), { passive: true });
  window.addEventListener("resize", throttle(updateFromScroll, 120));
  updateFromScroll();
}

function throttle(callback, delay) {
  let waiting = false;
  return () => {
    if (waiting) return;
    waiting = true;
    window.setTimeout(() => {
      waiting = false;
      callback();
    }, delay);
  };
}

function setupFolderInputs() {
  [
    ["taxReturnsFolder", "taxReturns"],
    ["workpapersFolder", "workpapers"],
    ["documentsFolder", "documents"],
  ].forEach(([inputId, type]) => {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener("change", () => {
      addFilesToType(type, Array.from(input.files || []));
      input.value = "";
    });
  });
}

async function addFilesToType(type, files) {
  if (!files.length) return;
  setRunningUploadState(true);
  try {
    filesByType[type] = mergeFiles(filesByType[type], files);
    renderFiles();
    renderValidation(validateBeforeReview({ showWarnings: true }));
  } catch (error) {
    renderValidation([{ blocks: true, text: error.message || "Could not read the uploaded files." }]);
  } finally {
    setRunningUploadState(false);
  }
}

function setRunningUploadState(isRunning) {
  els.runReview.disabled = isRunning;
  els.runHint.textContent = isRunning
    ? "Preparing uploaded package files..."
    : "The app will validate files, send the package to the backend, and display a structured review.";
}

async function expandZipFiles(files) {
  const expanded = [];
  for (const file of files) {
    if (fileExtension(file.name).toLowerCase() !== "zip") {
      expanded.push(file);
      continue;
    }
    expanded.push(...await extractZipFiles(file));
  }
  return expanded;
}

async function extractZipFiles(file) {
  const JSZip = window.JSZip;
  if (!JSZip) throw new Error("ZIP support is not loaded.");
  const zip = await JSZip.loadAsync(await fileArrayBuffer(file));
  const extracted = [];
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && !entry.name.startsWith("__MACOSX/"));
  for (const entry of entries) {
    const blob = await entry.async("blob");
    const innerName = `${file.name.replace(/\.zip$/i, "")}/${entry.name}`;
    const extractedFile = new File([blob], pathBaseName(entry.name), { type: guessMediaType(entry.name), lastModified: file.lastModified });
    Object.defineProperty(extractedFile, "__relativePath", { value: innerName });
    extracted.push(extractedFile);
  }
  return extracted;
}

function setupContextUploads() {
  [
    [els.knowledgeUpload, "knowledge_base"],
    [els.knowledgeFolderUpload, "knowledge_base"],
    [els.exampleUpload, "review_examples"],
    [els.exampleFolderUpload, "review_examples"],
  ].forEach(([input, kind]) => {
    if (!input) return;
    input.addEventListener("change", async () => {
      const files = Array.from(input.files || []);
      input.value = "";
      if (!files.length) return;
      await uploadContextFiles(kind, files);
    });
  });
}

async function uploadContextFiles(kind, files) {
  try {
    els.libraryStatus.textContent = `Preparing ${files.length} file(s)...`;
    const prepared = [];
    const skipped = [];
    for (const file of files) {
      const contextFiles = await prepareContextFiles(file);
      if (contextFiles.length) prepared.push(...contextFiles);
      else skipped.push(displayFileName(file));
    }
    if (!prepared.length) {
      els.libraryStatus.textContent = "No readable files were found. Use TXT, MD, CSV, JSON, DOCX, XLSX, PDF, or ZIP.";
      return;
    }

    els.libraryStatus.textContent = "Uploading reference files...";
    const response = await fetch(`${API_BASE_URL}/api/context/upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, files: prepared }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Upload failed with ${response.status}`);

    await loadServerConfig();
    const skippedCount = skipped.length + (payload.skipped?.length || 0);
    els.libraryStatus.textContent = `Saved ${payload.saved?.length || 0} file(s).${skippedCount ? ` Skipped ${skippedCount} unreadable file(s).` : ""}`;
    renderValidation(validateBeforeReview({ showWarnings: true }));
  } catch (error) {
    els.libraryStatus.textContent = error.message || "Reference upload failed.";
  }
}

async function prepareContextFiles(file) {
  if (fileExtension(file.name).toLowerCase() === "zip") {
    const innerFiles = await extractZipFiles(file);
    const prepared = [];
    for (const innerFile of innerFiles) prepared.push(...await prepareContextFiles(innerFile));
    return prepared;
  }

  const ext = fileExtension(file.name).toLowerCase();
  const name = displayFileName(file);
  if (["docx", "doc"].includes(ext)) {
    try {
      return [{ name: `${name}.txt`, text: await extractDocx(file) }];
    } catch (_) {
      return [];
    }
  }
  if (["xlsx", "xls"].includes(ext)) {
    try {
      return [{ name: `${name}.txt`, text: await extractXlsx(file) }];
    } catch (_) {
      return [];
    }
  }
  if (ext === "pdf") {
    try {
      return [{ name: `${name}.txt`, text: await extractPdfText(file) }];
    } catch (_) {
      return [];
    }
  }
  if (isTextLikeFile(file.type || guessMediaType(file.name), file.name)) {
    return [{ name, text: await fileTextContent(file) }];
  }
  return [];
}

function renderContextLists() {
  renderContextList(els.knowledgeList, serverConfig.knowledgeBaseFiles || []);
  renderContextList(els.exampleList, serverConfig.reviewExampleFiles || []);
}

function renderContextList(list, files) {
  if (!list) return;
  if (!files.length) {
    list.innerHTML = "<li>No files uploaded yet.</li>";
    return;
  }
  list.innerHTML = files.slice(0, 20).map((file) => `<li>${escapeHtml(file)}</li>`).join("");
}

function setupDropZones() {
  Object.entries(fileInputs).forEach(([type, input]) => {
    const card = input.closest(".upload-card");
    if (!card) return;

    ["dragenter", "dragover"].forEach((eventName) => {
      card.addEventListener(eventName, (event) => {
        event.preventDefault();
        card.classList.add("drag-over");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      card.addEventListener(eventName, (event) => {
        event.preventDefault();
        card.classList.remove("drag-over");
      });
    });

    card.addEventListener("drop", async (event) => {
      const droppedFiles = Array.from(event.dataTransfer?.files || []);
      if (!droppedFiles.length) return;
      await addFilesToType(type, droppedFiles);
    });
  });
}

function getAllFiles() {
  return Object.entries(filesByType).flatMap(([type, files]) => files.map((file) => ({ file, type })));
}

function mergeFiles(existing, incoming) {
  const seen = new Set(existing.map(fileKey));
  const merged = [...existing];
  incoming.forEach((file) => {
    if (!seen.has(fileKey(file))) merged.push(file);
  });
  return merged;
}

function assignDefaultTaxReturnRoles() {
  filesByType.taxReturns.forEach((file, index) => {
    const key = fileKey(file);
    if (!taxReturnRoles.has(key)) {
      taxReturnRoles.set(key, guessReviewFileRole(file, index));
    } else {
      taxReturnRoles.set(key, normalizeReviewRoleValue(taxReturnRoles.get(key)) || guessReviewFileRole(file, index));
    }
  });
}

function renderTaxReturnRole(file) {
  const key = fileKey(file);
  const value = normalizeReviewRoleValue(taxReturnRoles.get(key) || guessReviewFileRole(file));
  return `
    <label class="role-picker">
      <span>Detected role</span>
      <select class="return-role" data-key="${escapeHtml(key)}">
        <option value="current_return"${value === "current_return" ? " selected" : ""}>Current-year return</option>
        <option value="prior_return"${value === "prior_return" ? " selected" : ""}>Prior-year return</option>
        <option value="current_workpaper"${value === "current_workpaper" ? " selected" : ""}>Current-year workpaper</option>
        <option value="prior_workpaper"${value === "prior_workpaper" ? " selected" : ""}>Prior-year workpaper</option>
        <option value="supporting_document"${value === "supporting_document" ? " selected" : ""}>Supporting document</option>
      </select>
    </label>`;
}

function normalizeReviewRoleValue(value) {
  const role = String(value || "").toLowerCase();
  if (role === "current-year") return "current_return";
  if (role === "prior-year") return "prior_return";
  if (role === "other-return") return "supporting_document";
  if (["current_return", "prior_return", "current_workpaper", "prior_workpaper", "supporting_document"].includes(role)) return role;
  return "";
}

function guessReviewFileRole(file, index = 0) {
  const name = displayFileName(file).toLowerCase();
  const ext = fileExtension(name).toLowerCase();
  const taxYear = String(document.getElementById("taxYear")?.value || "").match(/\d{4}/)?.[0] || "";
  const priorYear = taxYear ? String(Number(taxYear) - 1) : "";
  const mentionsCurrent = taxYear && name.includes(taxYear);
  const mentionsPrior = priorYear && name.includes(priorYear);
  const isWorkpaper = /\b(workpaper|workpapers|work paper|wp\b|trial balance|balance sheet|p&l|profit|loss|book[-\s]?to[-\s]?tax|m-1|m-2|m-3)\b/i.test(name)
    || ["xlsx", "xls", "xlsm", "csv"].includes(ext);
  const isSupport = /\b(w-?2|w-?3|w-?9|1099|k-?1|pir\b|05-102|franchise|depreciation|bank statement|support|backup|docs?|documents?)\b/i.test(name)
    || ext === "zip" && !/\b(return|tax return|workpaper|workpapers)\b/i.test(name);
  const isReturn = /\b(return|tax return|form\s*(1040|1041|1065|1120|1120s|1120-s))\b/i.test(name) && !isWorkpaper && !isSupport;
  if (isWorkpaper) return mentionsPrior && !mentionsCurrent ? "prior_workpaper" : "current_workpaper";
  if (isReturn) return mentionsPrior && !mentionsCurrent ? "prior_return" : "current_return";
  if (isSupport) return "supporting_document";
  return "supporting_document";
}

function fileKey(file) {
  if (file?.driveFileId) return `drive:${file.driveFileId}`;
  if (file?.source === "quickbooks_online" || file?.source === "accounting_software") return `acct:${file.accountingSoftwareId || "quickbooks"}:${file.qboRealmId}:${file.qboReportId}:${file.name}`;
  return `${displayFileName(file)}:${file.size}:${file.lastModified}`;
}

function displayFileName(file) {
  return file.__relativePath || file.webkitRelativePath || file.name;
}

function pathBaseName(name) {
  return String(name || "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || "file";
}

function getSelectedReviewTypes() {
  return Array.from(document.querySelectorAll(".checks label"))
    .filter((label) => label.querySelector("input").checked)
    .map((label) => label.textContent.trim());
}

function readAsBase64(file) {
  if (isBase64BackedFile(file)) return Promise.resolve(file.content || "");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function isTextLikeFile(mediaType, fileName) {
  const ext = fileExtension(fileName).toLowerCase();
  return mediaType.startsWith("text/") || ["csv", "txt", "json", "md"].includes(ext);
}

function guessMediaType(fileName) {
  const ext = fileExtension(fileName).toLowerCase();
  return {
    csv: "text/csv",
    txt: "text/plain",
    json: "application/json",
    md: "text/markdown",
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: "application/msword",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
  }[ext] || "application/octet-stream";
}

function readabilityLabel(ext) {
  return ["PDF", "XLSX", "XLS", "DOCX", "CSV", "TXT", "JSON", "MD"].includes(ext) ? "content readable" : "metadata only";
}

function normalizedPriority(issue) {
  return String(issue.priority || issue.severity || "info").toLowerCase();
}

function normalizedArea(issue) {
  return String(issue.areaReviewed || issue.category || issue.formOrSchedule || "").toLowerCase();
}


function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index >= 2 ? 1 : 0)} ${units[index]}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function decodeBase64Text(content) {
  try {
    return decodeURIComponent(escape(atob(String(content || ""))));
  } catch (_) {
    try { return atob(String(content || "")); } catch (_) { return ""; }
  }
}

function fileExtension(fileName) {
  return (fileName.split(".").pop() || "FILE").toUpperCase();
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

// ===========================================================================
// Tax Planning Studio (Phase 1) — front-end module.
// Purely additive: all DOM ids are planning-scoped; reuses readAsBase64,
// downloadBase64File, showToast, escapeHtml. Tax numbers come from the server.
// ===========================================================================

const planningStudio = {
  inited: false,
  files: [],
  baseData: null,
  scenarios: [],
  opportunities: [],
  busy: false,
  view: "analysis",
  state: "empty",
  templates: [],
  styleProfile: null,
  editingId: null,
};

const PLANNING_FILING_STATUSES = ["Single", "MFJ", "MFS", "HOH"];
const PLANNING_CONFIRM_FIELDS = [
  { key: "clientName", label: "Client name", type: "text" },
  { key: "entityType", label: "Entity type", type: "text" },
  { key: "taxYear", label: "Tax year", type: "number" },
  { key: "filingStatus", label: "Filing status", type: "select" },
  { key: "state", label: "State", type: "text" },
  { key: "wages", label: "W-2 wages", type: "money" },
  { key: "netSEIncome", label: "Net SE / business income", type: "money" },
  { key: "otherIncome", label: "Other income", type: "money" },
  { key: "longTermGains", label: "Long-term cap gains", type: "money" },
  { key: "shortTermGains", label: "Short-term cap gains", type: "money" },
  { key: "deductions", label: "Itemized deductions (0 = standard)", type: "money" },
  { key: "qbi", label: "QBI", type: "money" },
  { key: "w2Wages", label: "Business W-2 wages (QBI limit)", type: "money" },
];

const PLANNING_FIELD_LABELS = {
  wages: "W-2 wages",
  netSEIncome: "Net SE income",
  otherIncome: "Other income",
  longTermGains: "LT cap gains",
  shortTermGains: "ST cap gains",
  deductions: "Deductions",
  qbi: "QBI",
  w2Wages: "Business W-2 wages",
  retirementContribution: "Retirement contribution",
  sec179: "Section 179",
  bonusDepreciation: "Bonus depreciation",
};

function planningFmtMoney(n) {
  const v = Math.round(Number(n) || 0);
  return `$${v.toLocaleString("en-US")}`;
}

function planningFmtPct(n) {
  const v = Number(n) || 0;
  const asPct = Math.abs(v) <= 1 ? v * 100 : v;
  return `${asPct.toFixed(1)}%`;
}

function planningSetStatus(text) {
  const chip = document.getElementById("planningStatus");
  if (chip) chip.textContent = text;
}

function planningShowState(name) {
  planningStudio.state = name;
  if (planningStudio.view !== "analysis") return; // library is showing; defer
  const states = ["empty", "loading", "confirm", "building", "results"];
  states.forEach((s) => {
    const el = document.getElementById(`planning${s.charAt(0).toUpperCase()}${s.slice(1)}`);
    if (el) el.hidden = s !== name;
  });
  const lib = document.getElementById("planningLibraryView");
  if (lib) lib.hidden = true;
}

function planningShowView(view) {
  planningStudio.view = view;
  document.getElementById("planningTabAnalysis")?.classList.toggle("active", view === "analysis");
  document.getElementById("planningTabLibrary")?.classList.toggle("active", view === "library");
  const lib = document.getElementById("planningLibraryView");
  const states = ["empty", "loading", "confirm", "building", "results"];
  if (view === "library") {
    states.forEach((s) => { const el = document.getElementById(`planning${s.charAt(0).toUpperCase()}${s.slice(1)}`); if (el) el.hidden = true; });
    if (lib) lib.hidden = false;
    planningLoadTemplates();
  } else {
    if (lib) lib.hidden = true;
    planningShowState(planningStudio.state || "empty");
  }
}

function initPlanningStudio() {
  if (planningStudio.inited) return;
  planningStudio.inited = true;

  const dz = document.getElementById("planningDropzone");
  const input = document.getElementById("planningFiles");
  dz?.addEventListener("click", () => input?.click());
  dz?.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input?.click(); } });
  dz?.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("planning-dragover"); });
  dz?.addEventListener("dragleave", () => dz.classList.remove("planning-dragover"));
  dz?.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("planning-dragover");
    planningAddFiles(e.dataTransfer?.files);
  });
  input?.addEventListener("change", () => { planningAddFiles(input.files); input.value = ""; });

  document.getElementById("planningAnalyzeBtn")?.addEventListener("click", planningAnalyze);
  document.getElementById("planningBackToUpload")?.addEventListener("click", () => planningShowState("empty"));
  document.getElementById("planningGenerateBtn")?.addEventListener("click", planningGenerateScenarios);
  document.getElementById("planningCustomBtn")?.addEventListener("click", planningAddCustomScenario);
  document.getElementById("planningCustomInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); planningAddCustomScenario(); } });
  document.getElementById("planningDeckBtn")?.addEventListener("click", planningDownloadDeck);
  document.getElementById("planningPresentBtn")?.addEventListener("click", () => planningTogglePresent(true));
  document.getElementById("planningExitPresent")?.addEventListener("click", () => planningTogglePresent(false));

  // Library sub-view
  document.getElementById("planningTabAnalysis")?.addEventListener("click", () => planningShowView("analysis"));
  document.getElementById("planningTabLibrary")?.addEventListener("click", () => planningShowView("library"));
  const libDz = document.getElementById("planningLibDropzone");
  const libInput = document.getElementById("planningLibFile");
  libDz?.addEventListener("click", () => libInput?.click());
  libDz?.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); libInput?.click(); } });
  libDz?.addEventListener("dragover", (e) => { e.preventDefault(); libDz.classList.add("planning-dragover"); });
  libDz?.addEventListener("dragleave", () => libDz.classList.remove("planning-dragover"));
  libDz?.addEventListener("drop", (e) => { e.preventDefault(); libDz.classList.remove("planning-dragover"); planningUploadTemplate(e.dataTransfer?.files?.[0]); });
  libInput?.addEventListener("change", () => { planningUploadTemplate(libInput.files?.[0]); libInput.value = ""; });
  document.getElementById("planningRegenBtn")?.addEventListener("click", planningRegenerateProfile);

  // Load library state once so the indicator is accurate from the start.
  planningLoadTemplates();
}

async function planningLoadTemplates() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/planning/templates`);
    if (!res.ok) return;
    const data = await res.json();
    planningStudio.templates = Array.isArray(data.templates) ? data.templates : [];
    planningStudio.styleProfile = data.styleProfile || null;
    planningRenderTemplates();
    planningRenderProfile();
    planningUpdateLibIndicator();
  } catch (_) { /* non-fatal */ }
}

function planningUpdateLibIndicator() {
  const el = document.getElementById("planningLibIndicator");
  if (!el) return;
  const active = planningStudio.templates.filter((t) => t.isActive).length;
  if (active > 0) {
    el.textContent = `${active} template${active === 1 ? "" : "s"} active — the AI will use your style`;
    el.classList.add("planning-lib-on");
  } else {
    el.textContent = "No templates — default format";
    el.classList.remove("planning-lib-on");
  }
}

function planningRenderTemplates() {
  const wrap = document.getElementById("planningLibList");
  if (!wrap) return;
  if (!planningStudio.templates.length) { wrap.innerHTML = "<p class=\"muted-note\">No templates uploaded yet.</p>"; return; }
  wrap.innerHTML = planningStudio.templates.map((t) => `
    <div class="planning-lib-item">
      <div class="planning-lib-item-main">
        <strong>${escapeHtml(t.filename)}</strong>
        <span class="planning-lib-meta">${escapeHtml(t.category || "")}${t.styleSummary?.tone ? ` · ${escapeHtml(t.styleSummary.tone)}` : ""}</span>
      </div>
      <label class="planning-lib-toggle"><input type="checkbox" data-planning-tpl="${t.id}" ${t.isActive ? "checked" : ""} /> Active</label>
      <button type="button" class="link-button planning-lib-del" data-planning-tpl-del="${t.id}">Delete</button>
    </div>`).join("");
  wrap.querySelectorAll("[data-planning-tpl]").forEach((cb) => {
    cb.addEventListener("change", () => planningToggleTemplate(cb.dataset.planningTpl, cb.checked));
  });
  wrap.querySelectorAll("[data-planning-tpl-del]").forEach((btn) => {
    btn.addEventListener("click", () => planningDeleteTemplate(btn.dataset.planningTplDel));
  });
}

function planningRenderProfile() {
  const wrap = document.getElementById("planningProfileView");
  if (!wrap) return;
  const p = planningStudio.styleProfile?.combinedSummary;
  if (!p) { wrap.innerHTML = "<p class=\"muted-note\">No active style profile — activate templates to build one.</p>"; return; }
  const row = (label, val) => val ? `<div class="planning-profile-row"><span>${escapeHtml(label)}</span><p>${escapeHtml(Array.isArray(val) ? val.join(" · ") : String(val))}</p></div>` : "";
  wrap.innerHTML = `
    ${row("Tone", p.tone)}
    ${row("Structure", p.structure)}
    ${row("Numbers", p.numberFormat)}
    ${row("Key phrases", p.keyPhrases)}
    ${row("Recommendation style", p.recommendationStyle)}
    ${row("Client language", p.clientLanguage)}
    ${row("Disclaimer", p.disclaimer)}`;
}

async function planningUploadTemplate(file) {
  if (!file || planningStudio.busy) return;
  const status = document.getElementById("planningLibStatus");
  const category = document.getElementById("planningLibCategory")?.value || "presentation";
  planningStudio.busy = true;
  if (status) status.textContent = `Processing ${file.name}…`;
  try {
    const content = await readAsBase64(file);
    const res = await fetch(`${API_BASE_URL}/api/planning/templates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: { name: file.name, type: file.type || "", content }, category }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not process template.");
    if (status) status.textContent = "";
    await planningLoadTemplates();
  } catch (err) {
    if (status) status.textContent = "";
    showToast(err.message || "Could not process template.", "error");
  } finally {
    planningStudio.busy = false;
  }
}

async function planningToggleTemplate(id, isActive) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/planning/templates/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    if (!res.ok) throw new Error("Update failed.");
    await planningLoadTemplates();
  } catch (err) {
    showToast(err.message || "Could not update template.", "error");
  }
}

async function planningDeleteTemplate(id) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/planning/templates/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Delete failed.");
    await planningLoadTemplates();
  } catch (err) {
    showToast(err.message || "Could not delete template.", "error");
  }
}

async function planningRegenerateProfile() {
  if (planningStudio.busy) return;
  planningStudio.busy = true;
  const status = document.getElementById("planningLibStatus");
  if (status) status.textContent = "Regenerating style profile…";
  try {
    const res = await fetch(`${API_BASE_URL}/api/planning/templates/regenerate-profile`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not regenerate profile.");
    if (status) status.textContent = "";
    await planningLoadTemplates();
  } catch (err) {
    if (status) status.textContent = "";
    showToast(err.message || "Could not regenerate profile.", "error");
  } finally {
    planningStudio.busy = false;
  }
}

async function planningAddFiles(fileList) {
  const files = Array.from(fileList || []);
  for (const file of files) {
    try {
      const content = await readAsBase64(file);
      planningStudio.files.push({ name: file.name, type: file.type || "", content });
    } catch (_) {
      showToast(`Could not read ${file.name}.`, "error");
    }
  }
  planningRenderFileList();
}

function planningRenderFileList() {
  const list = document.getElementById("planningFileList");
  if (!list) return;
  if (!planningStudio.files.length) { list.innerHTML = ""; return; }
  list.innerHTML = planningStudio.files.map((f, i) =>
    `<span class="planning-file-chip">${escapeHtml(f.name)}<button type="button" data-planning-remove="${i}" aria-label="Remove">×</button></span>`
  ).join("");
  list.querySelectorAll("[data-planning-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      planningStudio.files.splice(Number(btn.dataset.planningRemove), 1);
      planningRenderFileList();
    });
  });
}

async function planningAnalyze() {
  if (planningStudio.busy) return;
  const instructions = document.getElementById("planningInstructions")?.value || "";
  if (!planningStudio.files.length && !instructions.trim()) {
    showToast("Upload at least one document or write some instructions.", "error");
    return;
  }
  planningStudio.busy = true;
  planningShowState("loading");
  planningSetStatus("Analyzing…");
  try {
    const res = await fetch(`${API_BASE_URL}/api/planning/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files: planningStudio.files, instructions }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Analysis failed.");
    planningStudio.baseData = data.baseData;
    planningRenderConfirm(data.baseData, data.keyObservations || []);
    planningShowState("confirm");
    planningSetStatus("Review profile");
  } catch (err) {
    showToast(err.message || "Analysis failed.", "error");
    planningShowState("empty");
    planningSetStatus("Ready");
  } finally {
    planningStudio.busy = false;
  }
}

function planningRenderConfirm(baseData, observations) {
  const obs = document.getElementById("planningObservations");
  if (obs) {
    obs.innerHTML = (Array.isArray(observations) && observations.length)
      ? `<strong>AI observations</strong><ul>${observations.map((o) => `<li>${escapeHtml(String(o))}</li>`).join("")}</ul>`
      : "";
  }
  const wrap = document.getElementById("planningConfirmFields");
  if (!wrap) return;
  wrap.innerHTML = PLANNING_CONFIRM_FIELDS.map((f) => {
    const raw = baseData[f.key];
    const val = raw == null ? "" : raw;
    if (f.type === "select") {
      const opts = PLANNING_FILING_STATUSES.map((s) => `<option value="${s}" ${s === val ? "selected" : ""}>${s}</option>`).join("");
      return `<label class="field"><span>${escapeHtml(f.label)}</span><select id="planning-f-${f.key}">${opts}</select></label>`;
    }
    const inputType = f.type === "text" ? "text" : "number";
    const v = f.type === "money" || f.type === "number" ? (Number(val) || 0) : escapeHtml(String(val));
    return `<label class="field"><span>${escapeHtml(f.label)}</span><input id="planning-f-${f.key}" type="${inputType}" value="${v}" /></label>`;
  }).join("");
}

function planningCollectConfirm() {
  const base = { ...(planningStudio.baseData || {}) };
  PLANNING_CONFIRM_FIELDS.forEach((f) => {
    const el = document.getElementById(`planning-f-${f.key}`);
    if (!el) return;
    if (f.type === "money" || f.type === "number") base[f.key] = Number(el.value) || 0;
    else base[f.key] = el.value;
  });
  return base;
}

async function planningGenerateScenarios() {
  if (planningStudio.busy) return;
  planningStudio.baseData = planningCollectConfirm();
  const instructions = document.getElementById("planningInstructions")?.value || "";
  planningStudio.busy = true;
  planningShowState("building");
  planningSetStatus("Building scenarios…");
  try {
    const year = Number(planningStudio.baseData.taxYear) || new Date().getFullYear();
    const sres = await fetch(`${API_BASE_URL}/api/planning/scenarios`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseData: planningStudio.baseData, year, instructions }),
    });
    const sdata = await sres.json();
    if (!sres.ok) throw new Error(sdata.error || "Scenario generation failed.");
    planningStudio.scenarios = Array.isArray(sdata.scenarios) ? sdata.scenarios : [];

    document.getElementById("planningBuildingText").textContent = "Identifying opportunities…";
    const ores = await fetch(`${API_BASE_URL}/api/planning/opportunities`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseData: planningStudio.baseData, scenarios: planningStudio.scenarios }),
    });
    const odata = await ores.json();
    planningStudio.opportunities = ores.ok && Array.isArray(odata.opportunities) ? odata.opportunities : [];

    planningRenderResults();
    planningShowState("results");
    planningSetStatus("Ready to present");
  } catch (err) {
    showToast(err.message || "Could not build scenarios.", "error");
    planningShowState("confirm");
    planningSetStatus("Review profile");
  } finally {
    planningStudio.busy = false;
  }
}

function planningBestScenarioId() {
  let best = null;
  planningStudio.scenarios.forEach((s) => {
    if (s.isBase) return;
    const t = Number(s?.taxCalc?.total);
    if (!Number.isFinite(t)) return;
    if (!best || t < Number(best.taxCalc.total)) best = s;
  });
  return best ? best.id : null;
}

function planningRenderResults() {
  planningRenderComparison();
  planningRenderOpportunities();
}

function planningRenderComparison() {
  const wrap = document.getElementById("planningComparison");
  if (!wrap) return;
  if (!planningStudio.scenarios.length) { wrap.innerHTML = "<p class=\"muted-note\">No scenarios yet.</p>"; return; }
  const bestId = planningBestScenarioId();
  const rows = planningStudio.scenarios.map((s) => {
    const c = s.taxCalc || {};
    const savings = s?.savingsVsBase?.dollars || 0;
    const isBest = s.id === bestId && savings > 0;
    const editBtn = s.isBase ? "" : `<button type="button" class="link-button planning-edit-btn" data-planning-edit="${s.id}">Edit</button>`;
    const main = `<tr class="${isBest ? "planning-row-best" : ""}">
      <td>${escapeHtml(s.name)}${isBest ? ' <span class="planning-badge">Best</span>' : ""} ${editBtn}</td>
      <td>${planningFmtMoney(c.taxableIncome)}</td>
      <td>${planningFmtMoney(c.federalTax)}</td>
      <td>${planningFmtMoney(c.stateTax)}${c.stateEstimated ? '<span class="planning-est" title="Estimated state rate">*</span>' : ""}</td>
      <td>${planningFmtMoney(c.seTax)}</td>
      <td><strong>${planningFmtMoney(c.total)}</strong></td>
      <td class="${savings > 0 ? "planning-pos" : ""}">${savings > 0 ? planningFmtMoney(savings) : "—"}</td>
      <td>${planningFmtPct(c.effectiveRate)}</td>
    </tr>`;
    if (planningStudio.editingId !== s.id) return main;
    const adjs = Array.isArray(s.adjustments) ? s.adjustments : [];
    const editorFields = (adjs.length ? adjs : [{ field: "retirementContribution", newValue: 0 }]).map((a) => {
      const label = PLANNING_FIELD_LABELS[a.field] || a.field;
      const val = a.newValue != null ? a.newValue : (a.delta != null ? a.delta : 0);
      return `<label class="planning-edit-field"><span>${escapeHtml(label)}</span><input type="number" data-planning-adj-field="${escapeHtml(a.field)}" value="${Number(val) || 0}" /></label>`;
    }).join("");
    const editor = `<tr class="planning-editor-row"><td colspan="8">
      <div class="planning-editor">
        <strong>Edit assumptions</strong>
        <div class="planning-edit-grid">${editorFields}</div>
        <div class="planning-actions">
          <button type="button" class="ghost-button small-button" data-planning-edit-cancel>Cancel</button>
          <button type="button" class="primary-button small-button" data-planning-edit-apply="${s.id}">Apply</button>
        </div>
      </div></td></tr>`;
    return main + editor;
  }).join("");
  const anyEstimated = planningStudio.scenarios.some((s) => s?.taxCalc?.stateEstimated);
  wrap.innerHTML = `
    <table class="planning-table">
      <thead><tr>
        <th>Scenario</th><th>Taxable income</th><th>Federal</th><th>State</th><th>SE tax</th><th>Total tax</th><th>Savings vs. base</th><th>Eff. rate</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${anyEstimated ? '<p class="muted-note">* State tax uses an estimated rate; confirm against the actual state return.</p>' : ""}`;

  wrap.querySelectorAll("[data-planning-edit]").forEach((b) => b.addEventListener("click", () => { planningStudio.editingId = b.dataset.planningEdit; planningRenderComparison(); }));
  wrap.querySelector("[data-planning-edit-cancel]")?.addEventListener("click", () => { planningStudio.editingId = null; planningRenderComparison(); });
  wrap.querySelector("[data-planning-edit-apply]")?.addEventListener("click", (e) => planningApplyScenarioEdit(e.currentTarget.dataset.planningEditApply));
}

async function planningApplyScenarioEdit(id) {
  const scenario = planningStudio.scenarios.find((s) => s.id === id);
  if (!scenario) return;
  const wrap = document.getElementById("planningComparison");
  const adjustments = Array.from(wrap.querySelectorAll("[data-planning-adj-field]")).map((inp) => ({
    field: inp.dataset.planningAdjField,
    newValue: Number(inp.value) || 0,
  }));
  const base = planningStudio.scenarios.find((s) => s.isBase);
  try {
    const res = await fetch(`${API_BASE_URL}/api/planning/recompute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseData: planningStudio.baseData, adjustments, year: planningStudio.baseData?.taxYear, baseTotal: base?.taxCalc?.total }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Recompute failed.");
    scenario.adjustments = data.adjustments;
    scenario.taxCalc = data.taxCalc;
    scenario.savingsVsBase = data.savingsVsBase;
    planningStudio.editingId = null;
    planningRenderComparison();
  } catch (err) {
    showToast(err.message || "Could not apply changes.", "error");
  }
}

function planningRenderOpportunities() {
  const wrap = document.getElementById("planningOpportunities");
  if (!wrap) return;
  if (!planningStudio.opportunities.length) { wrap.innerHTML = "<p class=\"muted-note\">No opportunities identified.</p>"; return; }
  const sorted = [...planningStudio.opportunities].sort((a, b) => (Number(b?.estimatedSavings?.max) || 0) - (Number(a?.estimatedSavings?.max) || 0));
  wrap.innerHTML = sorted.map((o) => {
    const min = Number(o?.estimatedSavings?.min) || 0;
    const max = Number(o?.estimatedSavings?.max) || 0;
    const range = max ? `${planningFmtMoney(min)}–${planningFmtMoney(max)}` : "—";
    const complexity = escapeHtml(o.complexity || "Moderate");
    return `<article class="planning-opp-card planning-complexity-${complexity.toLowerCase()}">
      <div class="planning-opp-head">
        <strong>${escapeHtml(o.title || "Opportunity")}</strong>
        <span class="planning-opp-savings">${range}</span>
      </div>
      <p class="planning-opp-meta">${escapeHtml(o.category || "")}${o.deadline ? ` · by ${escapeHtml(o.deadline)}` : ""} · ${complexity}</p>
      <p>${escapeHtml(o.description || "")}</p>
      ${o.cpaNote ? `<p class="planning-opp-note"><strong>CPA note:</strong> ${escapeHtml(o.cpaNote)}</p>` : ""}
    </article>`;
  }).join("");
}

async function planningAddCustomScenario() {
  if (planningStudio.busy) return;
  const input = document.getElementById("planningCustomInput");
  const instruction = input?.value?.trim();
  if (!instruction) { showToast("Describe the scenario to add.", "error"); return; }
  const base = planningStudio.scenarios.find((s) => s.isBase);
  planningStudio.busy = true;
  planningSetStatus("Adding scenario…");
  try {
    const year = Number(planningStudio.baseData?.taxYear) || new Date().getFullYear();
    const res = await fetch(`${API_BASE_URL}/api/planning/scenario`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseData: planningStudio.baseData, instruction, year, baseTotal: base?.taxCalc?.total }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not add scenario.");
    planningStudio.scenarios.push(data.scenario);
    planningRenderComparison();
    if (input) input.value = "";
    planningSetStatus("Ready to present");
  } catch (err) {
    showToast(err.message || "Could not add scenario.", "error");
  } finally {
    planningStudio.busy = false;
  }
}

// Derive concrete next steps from the opportunities the AI surfaced (what / when / who).
function planningDeriveNextSteps() {
  return [...planningStudio.opportunities]
    .filter((o) => o.requiresAction || o.actionDeadline || o.deadline)
    .sort((a, b) => (Number(b?.estimatedSavings?.max) || 0) - (Number(a?.estimatedSavings?.max) || 0))
    .slice(0, 8)
    .map((o) => {
      const complexity = String(o.complexity || "").toLowerCase();
      const owner = complexity === "complex" ? "CPA" : complexity === "simple" ? "Client" : "CPA & Client";
      return { action: o.title || "Action", owner, deadline: o.actionDeadline || o.deadline || "" };
    });
}

async function planningDownloadDeck() {
  if (planningStudio.busy) return;
  planningStudio.busy = true;
  planningSetStatus("Building deck…");
  try {
    const res = await fetch(`${API_BASE_URL}/api/planning/deck`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientName: planningStudio.baseData?.clientName || "Client",
        year: planningStudio.baseData?.taxYear,
        baseData: planningStudio.baseData,
        scenarios: planningStudio.scenarios,
        opportunities: planningStudio.opportunities,
        nextSteps: planningDeriveNextSteps(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Deck generation failed.");
    downloadBase64File(data.filename || "TaxPlanning.pptx", data.contentBase64, data.mimeType);
    planningSetStatus("Deck downloaded");
  } catch (err) {
    showToast(err.message || "Deck generation failed.", "error");
  } finally {
    planningStudio.busy = false;
  }
}

function planningTogglePresent(on) {
  const overlay = document.getElementById("planningPresent");
  if (!overlay) return;
  if (on) planningRenderPresentation();
  overlay.hidden = !on;
}

function planningRenderPresentation() {
  const inner = document.getElementById("planningPresentInner");
  if (!inner) return;
  const base = planningStudio.scenarios.find((s) => s.isBase) || planningStudio.scenarios[0];
  const baseCalc = base?.taxCalc || {};
  const bestId = planningBestScenarioId();
  const best = planningStudio.scenarios.find((s) => s.id === bestId);
  const bestSavings = best ? (base?.taxCalc?.total || 0) - (best.taxCalc?.total || 0) : 0;
  const year = planningStudio.baseData?.taxYear || new Date().getFullYear();
  const client = planningStudio.baseData?.clientName || "Client";

  const compRows = planningStudio.scenarios.map((s) => {
    const c = s.taxCalc || {};
    const sav = s?.savingsVsBase?.dollars || 0;
    return `<tr class="${s.id === bestId && sav > 0 ? "planning-row-best" : ""}"><td>${escapeHtml(s.name)}</td><td>${planningFmtMoney(c.total)}</td><td>${sav > 0 ? planningFmtMoney(sav) : "—"}</td><td>${planningFmtPct(c.effectiveRate)}</td></tr>`;
  }).join("");

  const oppCards = [...planningStudio.opportunities]
    .sort((a, b) => (Number(b?.estimatedSavings?.max) || 0) - (Number(a?.estimatedSavings?.max) || 0))
    .map((o) => {
      const max = Number(o?.estimatedSavings?.max) || 0;
      const min = Number(o?.estimatedSavings?.min) || 0;
      return `<div class="planning-present-opp"><strong>${escapeHtml(o.title)}</strong><span>${max ? `${planningFmtMoney(min)}–${planningFmtMoney(max)}` : ""}</span><p>${escapeHtml(o.description || "")}</p></div>`;
    }).join("");

  inner.innerHTML = `
    <header class="planning-present-header">
      <h1>Tax Planning Analysis ${escapeHtml(String(year))}</h1>
      <p>${escapeHtml(client)} · ${new Date().toLocaleDateString()}</p>
    </header>
    <section class="planning-present-hero">
      <div><span class="planning-present-num">${planningFmtMoney(baseCalc.total)}</span><label>Current total tax</label></div>
      <div><span class="planning-present-num">${planningFmtPct(baseCalc.effectiveRate)}</span><label>Effective rate</label></div>
      <div><span class="planning-present-num">${planningFmtMoney(baseCalc.taxableIncome)}</span><label>Taxable income</label></div>
    </section>
    ${bestSavings > 0 ? `<p class="planning-present-headline">Potential savings of <strong>${planningFmtMoney(bestSavings)}</strong> identified.</p>` : ""}
    <h2>Scenario comparison</h2>
    <table class="planning-table"><thead><tr><th>Scenario</th><th>Total tax</th><th>Savings vs. today</th><th>Effective rate</th></tr></thead><tbody>${compRows}</tbody></table>
    ${oppCards ? `<h2>Recommended opportunities</h2><div class="planning-present-opps">${oppCards}</div>` : ""}
    ${(function () {
      const steps = planningDeriveNextSteps();
      if (!steps.length) return "";
      const items = steps.map((s) => `<li><strong>${escapeHtml(s.action)}</strong>${s.deadline ? ` — by ${escapeHtml(s.deadline)}` : ""} <span class="planning-step-owner">${escapeHtml(s.owner)}</span></li>`).join("");
      return `<h2>Next steps</h2><ol class="planning-present-steps">${items}</ol>`;
    })()}
    <footer class="planning-present-footer">Prepared for planning purposes. Figures are estimates based on the information provided and current tax law. Consult your CPA before acting.</footer>`;
}

init();

