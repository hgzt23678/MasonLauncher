export const supportedLanguages = ['ja', 'en', 'zh-Hant', 'zh-Hans', 'ko'] as const;

export type SupportedLanguage = (typeof supportedLanguages)[number];
export type LanguagePreference = 'system' | SupportedLanguage;

type Message = {
  ja: string;
  en: string;
  zhHant: string;
  zhHans: string;
  ko: string;
};

const messages = {
  'language.system': { ja: 'システム設定', en: 'System language', zhHant: '系統語言', zhHans: '系统语言', ko: '시스템 언어' },
  'language.ja': { ja: '日本語', en: '日本語', zhHant: '日本語', zhHans: '日本語', ko: '日本語' },
  'language.en': { ja: 'English', en: 'English', zhHant: 'English', zhHans: 'English', ko: 'English' },
  'language.zhHant': { ja: '繁體中文', en: '繁體中文', zhHant: '繁體中文', zhHans: '繁體中文', ko: '繁體中文' },
  'language.zhHans': { ja: '简体中文', en: '简体中文', zhHant: '简体中文', zhHans: '简体中文', ko: '简体中文' },
  'language.ko': { ja: '한국어', en: '한국어', zhHant: '한국어', zhHans: '한국어', ko: '한국어' },
  'common.close': { ja: '閉じる', en: 'Close', zhHant: '關閉', zhHans: '关闭', ko: '닫기' },
  'common.cancel': { ja: 'キャンセル', en: 'Cancel', zhHant: '取消', zhHans: '取消', ko: '취소' },
  'common.save': { ja: '保存', en: 'Save', zhHant: '儲存', zhHans: '保存', ko: '저장' },
  'common.delete': { ja: '削除', en: 'Delete', zhHant: '刪除', zhHans: '删除', ko: '삭제' },
  'common.edit': { ja: '編集', en: 'Edit', zhHant: '編輯', zhHans: '编辑', ko: '편집' },
  'common.open': { ja: '開く', en: 'Open', zhHant: '開啟', zhHans: '打开', ko: '열기' },
  'common.retry': { ja: '再試行', en: 'Retry', zhHant: '重試', zhHans: '重试', ko: '다시 시도' },
  'common.unknown': { ja: '不明', en: 'Unknown', zhHant: '未知', zhHans: '未知', ko: '알 수 없음' },
  'common.none': { ja: 'なし', en: 'None', zhHant: '無', zhHans: '无', ko: '없음' },
  'login.lead': { ja: 'Microsoft アカウントでログインして、Minecraft を始めましょう。', en: 'Sign in with your Microsoft account to start Minecraft.', zhHant: '使用 Microsoft 帳戶登入以啟動 Minecraft。', zhHans: '使用 Microsoft 帐户登录以启动 Minecraft。', ko: 'Microsoft 계정으로 로그인하여 Minecraft를 시작하세요.' },
  'login.button': { ja: 'Microsoft でログイン', en: 'Sign in with Microsoft', zhHant: '使用 Microsoft 登入', zhHans: '使用 Microsoft 登录', ko: 'Microsoft로 로그인' },
  'login.deviceInstruction': { ja: '次のページを開き、表示されたコードを入力してください。', en: 'Open the following page and enter the displayed code.', zhHant: '開啟下列頁面並輸入顯示的代碼。', zhHans: '打开以下页面并输入显示的代码。', ko: '다음 페이지를 열고 표시된 코드를 입력하세요.' },
  'login.copyCode': { ja: 'コードをコピー', en: 'Copy code', zhHant: '複製代碼', zhHans: '复制代码', ko: '코드 복사' },
  'login.openPage': { ja: 'ログインページを開く', en: 'Open sign-in page', zhHant: '開啟登入頁面', zhHans: '打开登录页面', ko: '로그인 페이지 열기' },
  'login.productLabel': { ja: 'スタンドアロンランチャー', en: 'Standalone launcher', zhHant: '獨立啟動器', zhHans: '独立启动器', ko: '독립 실행형 런처' },
  'login.clientIdTitle': { ja: 'Debug: Microsoft Entra Client ID', en: 'Debug: Microsoft Entra Client ID', zhHant: 'Debug：Microsoft Entra 用戶端識別碼', zhHans: 'Debug：Microsoft Entra 客户端 ID', ko: 'Debug: Microsoft Entra 클라이언트 ID' },
  'login.clientIdDescription': { ja: '開発用のApplication (client) IDを設定ファイルへ保存します。', en: 'Save the Application (client) ID used for development to the settings file.', zhHant: '將開發用的應用程式（用戶端）識別碼儲存至設定檔。', zhHans: '将开发用的应用程序（客户端）ID 保存到设置文件。', ko: '개발용 애플리케이션(클라이언트) ID를 설정 파일에 저장합니다.' },
  'login.clientIdLabel': { ja: 'Application (client) ID', en: 'Application (client) ID', zhHant: '應用程式（用戶端）識別碼', zhHans: '应用程序（客户端）ID', ko: '애플리케이션(클라이언트) ID' },
  'login.clientIdSave': { ja: 'Client IDを保存', en: 'Save Client ID', zhHant: '儲存用戶端識別碼', zhHans: '保存客户端 ID', ko: '클라이언트 ID 저장' },
  'login.clientIdSaved': { ja: 'Client IDを保存しました。Microsoftログインを開始できます。', en: 'Client ID saved. You can now start Microsoft sign-in.', zhHant: '用戶端識別碼已儲存。現在可以開始 Microsoft 登入。', zhHans: '客户端 ID 已保存。现在可以开始 Microsoft 登录。', ko: '클라이언트 ID를 저장했습니다. 이제 Microsoft 로그인을 시작할 수 있습니다.' },
  'login.clientIdInvalid': { ja: 'Application (client) IDをGUID形式で入力してください。', en: 'Enter the Application (client) ID in GUID format.', zhHant: '請以 GUID 格式輸入應用程式（用戶端）識別碼。', zhHans: '请以 GUID 格式输入应用程序（客户端）ID。', ko: '애플리케이션(클라이언트) ID를 GUID 형식으로 입력하세요.' },
  'nav.main': { ja: 'メインメニュー', en: 'Main menu', zhHant: '主選單', zhHans: '主菜单', ko: '주 메뉴' },
  'nav.home': { ja: 'ホーム', en: 'Home', zhHant: '首頁', zhHans: '主页', ko: '홈' },
  'nav.profiles': { ja: 'プロファイル', en: 'Profiles', zhHant: '設定檔', zhHans: '配置文件', ko: '프로필' },
  'nav.settings': { ja: '設定', en: 'Settings', zhHant: '設定', zhHans: '设置', ko: '설정' },
  'nav.openFolder': { ja: 'ゲームフォルダー', en: 'Game folder', zhHant: '遊戲資料夾', zhHans: '游戏文件夹', ko: '게임 폴더' },
  'nav.rescan': { ja: '再スキャン', en: 'Rescan', zhHant: '重新掃描', zhHans: '重新扫描', ko: '다시 검색' },
  'sidebar.running': { ja: 'ランチャー稼働中', en: 'Launcher running', zhHant: '啟動器執行中', zhHans: '启动器运行中', ko: '런처 실행 중' },
  'sidebar.scan': { ja: 'Mojang 公式バージョン情報を取得しています...', en: 'Loading official Mojang version information...', zhHant: '正在載入 Mojang 官方版本資訊...', zhHans: '正在加载 Mojang 官方版本信息...', ko: 'Mojang 공식 버전 정보를 불러오는 중...' },
  'sidebar.accountLogin': { ja: 'アカウントでログイン', en: 'Sign in', zhHant: '登入帳戶', zhHans: '登录帐户', ko: '계정 로그인' },
  'profiles.title': { ja: 'プロファイル', en: 'Profiles', zhHant: '設定檔', zhHans: '配置文件', ko: '프로필' },
  'profiles.add': { ja: 'プロファイルを追加', en: 'Add profile', zhHant: '新增設定檔', zhHans: '添加配置文件', ko: '프로필 추가' },
  'profiles.empty': { ja: 'プロファイルがありません。', en: 'No profiles yet.', zhHant: '尚無設定檔。', zhHans: '暂无配置文件。', ko: '프로필이 없습니다.' },
  'profiles.selected': { ja: '選択中', en: 'Selected', zhHant: '已選取', zhHans: '已选择', ko: '선택됨' },
  'profiles.installed': { ja: 'インストール済み', en: 'Installed', zhHant: '已安裝', zhHans: '已安装', ko: '설치됨' },
  'profiles.notInstalled': { ja: '未インストール', en: 'Not installed', zhHant: '未安裝', zhHans: '未安装', ko: '설치되지 않음' },
  'profiles.openInstance': { ja: 'インスタンスフォルダを開く', en: 'Open instance folder', zhHant: '開啟執行個體資料夾', zhHans: '打开实例文件夹', ko: '인스턴스 폴더 열기' },
  'profiles.openLogs': { ja: 'ログフォルダを開く', en: 'Open log folder', zhHant: '開啟記錄資料夾', zhHans: '打开日志文件夹', ko: '로그 폴더 열기' },
  'profiles.openLatestLog': { ja: 'latest.logを開く', en: 'Open latest.log', zhHant: '開啟 latest.log', zhHans: '打开 latest.log', ko: 'latest.log 열기' },
  'profiles.copyRepro': { ja: 'PowerShell再現スクリプトをコピー', en: 'Copy PowerShell reproduction script', zhHant: '複製 PowerShell 重現指令碼', zhHans: '复制 PowerShell 复现脚本', ko: 'PowerShell 재현 스크립트 복사' },
  'profiles.scanConnected': { ja: '{count} 個のプロファイルを読み込みました。', en: 'Loaded {count} profiles.', zhHant: '已載入 {count} 個設定檔。', zhHans: '已加载 {count} 个配置文件。', ko: '프로필 {count}개를 불러왔습니다.' },
  'profiles.scanFailed': { ja: 'Mojang に接続できません', en: 'Could not connect to Mojang', zhHant: '無法連線至 Mojang', zhHans: '无法连接到 Mojang', ko: 'Mojang에 연결할 수 없습니다' },
  'profiles.loadFailed': { ja: 'ランチャー情報の読み込みに失敗しました。', en: 'Failed to load launcher information.', zhHant: '無法載入啟動器資訊。', zhHans: '无法加载启动器信息。', ko: '런처 정보를 불러오지 못했습니다.' },
  'status.ready': { ja: '準備完了', en: 'Ready', zhHant: '準備完成', zhHans: '准备就绪', ko: '준비 완료' },
  'status.notSelected': { ja: '未選択', en: 'Not selected', zhHant: '未選取', zhHans: '未选择', ko: '선택되지 않음' },
  'settings.title': { ja: '設定', en: 'Settings', zhHant: '設定', zhHans: '设置', ko: '설정' },
  'settings.account': { ja: 'アカウント', en: 'Account', zhHant: '帳戶', zhHans: '帐户', ko: '계정' },
  'settings.accountState': { ja: 'アカウント状態', en: 'Account status', zhHant: '帳戶狀態', zhHans: '帐户状态', ko: '계정 상태' },
  'settings.authMethod': { ja: '認証方式', en: 'Authentication', zhHant: '驗證方式', zhHans: '身份验证方式', ko: '인증 방식' },
  'settings.authMethodDescription': { ja: 'Microsoft Entra ID のデバイスコードフローを使用します。', en: 'Uses the Microsoft Entra ID device code flow.', zhHant: '使用 Microsoft Entra ID 裝置代碼流程。', zhHans: '使用 Microsoft Entra ID 设备代码流。', ko: 'Microsoft Entra ID 장치 코드 흐름을 사용합니다.' },
  'settings.gameDirectory': { ja: 'ゲームディレクトリ', en: 'Game directory', zhHant: '遊戲目錄', zhHans: '游戏目录', ko: '게임 디렉터리' },
  'settings.openDirectory': { ja: 'フォルダを開く', en: 'Open folder', zhHant: '開啟資料夾', zhHans: '打开文件夹', ko: '폴더 열기' },
  'settings.changeDirectory': { ja: '変更', en: 'Change', zhHant: '變更', zhHans: '更改', ko: '변경' },
  'settings.statistics': { ja: '統計', en: 'Statistics', zhHant: '統計', zhHans: '统计', ko: '통계' },
  'settings.worlds': { ja: 'ワールド', en: 'Worlds', zhHant: '世界', zhHans: '世界', ko: '월드' },
  'settings.screenshots': { ja: 'スクリーンショット', en: 'Screenshots', zhHant: '螢幕擷取畫面', zhHans: '截图', ko: '스크린샷' },
  'settings.defaultMemory': { ja: '既定のメモリ', en: 'Default memory', zhHant: '預設記憶體', zhHans: '默认内存', ko: '기본 메모리' },
  'settings.defaultMemoryDescription': { ja: 'プロファイルで個別指定しない場合に使用します。', en: 'Used when a profile does not specify its own value.', zhHant: '設定檔未個別指定時使用。', zhHans: '配置文件未单独指定时使用。', ko: '프로필에서 별도로 지정하지 않을 때 사용합니다.' },
  'settings.minMemory': { ja: '最小メモリ (MB)', en: 'Minimum memory (MB)', zhHant: '最小記憶體 (MB)', zhHans: '最小内存 (MB)', ko: '최소 메모리 (MB)' },
  'settings.maxMemory': { ja: '最大メモリ (MB)', en: 'Maximum memory (MB)', zhHant: '最大記憶體 (MB)', zhHans: '最大内存 (MB)', ko: '최대 메모리 (MB)' },
  'settings.saveMemory': { ja: '設定を保存', en: 'Save settings', zhHant: '儲存設定', zhHans: '保存设置', ko: '설정 저장' },
  'settings.language': { ja: '言語', en: 'Language', zhHant: '語言', zhHans: '语言', ko: '언어' },
  'settings.languageLabel': { ja: '表示言語', en: 'Display language', zhHant: '顯示語言', zhHans: '显示语言', ko: '표시 언어' },
  'settings.languageDescription': { ja: 'システム設定では、対応するOS言語を自動的に使用します。', en: 'System language automatically follows a supported OS language.', zhHant: '系統語言會自動使用支援的作業系統語言。', zhHans: '系统语言会自动使用支持的操作系统语言。', ko: '시스템 언어는 지원되는 운영 체제 언어를 자동으로 사용합니다.' },
  'settings.javaManagement': { ja: 'Java 管理', en: 'Java management', zhHant: 'Java 管理', zhHans: 'Java 管理', ko: 'Java 관리' },
  'settings.javaDescription': { ja: 'Minecraftのバージョンに合うEclipse Temurinを管理します。', en: 'Manage Eclipse Temurin versions suitable for each Minecraft version.', zhHant: '管理適合各 Minecraft 版本的 Eclipse Temurin。', zhHans: '管理适合各 Minecraft 版本的 Eclipse Temurin。', ko: 'Minecraft 버전에 맞는 Eclipse Temurin을 관리합니다.' },
  'settings.installJava': { ja: 'Javaをインストール', en: 'Install Java', zhHant: '安裝 Java', zhHans: '安装 Java', ko: 'Java 설치' },
  'settings.refreshJava': { ja: '再読み込み', en: 'Refresh', zhHant: '重新整理', zhHans: '刷新', ko: '새로 고침' },
  'settings.addJava': { ja: '手動で追加', en: 'Add manually', zhHant: '手動新增', zhHans: '手动添加', ko: '수동 추가' },
  'settings.developerLogs': { ja: '開発者ログ', en: 'Developer logs', zhHant: '開發者記錄', zhHans: '开发者日志', ko: '개발자 로그' },
  'settings.developerLogsDescription': { ja: '起動処理やダウンロードの詳細を表示します。', en: 'Show details about launches and downloads.', zhHant: '顯示啟動與下載的詳細資訊。', zhHans: '显示启动和下载的详细信息。', ko: '실행 및 다운로드 세부 정보를 표시합니다.' },
  'settings.showDeveloperLogs': { ja: '開発者ログを表示', en: 'Show developer logs', zhHant: '顯示開發者記錄', zhHans: '显示开发者日志', ko: '개발자 로그 표시' },
  'settings.clearLogs': { ja: 'ログを消去', en: 'Clear logs', zhHant: '清除記錄', zhHans: '清除日志', ko: '로그 지우기' },
  'settings.exportLogs': { ja: 'ログを保存', en: 'Save logs', zhHant: '儲存記錄', zhHans: '保存日志', ko: '로그 저장' },
  'settings.saved': { ja: '設定を保存しました。', en: 'Settings saved.', zhHant: '設定已儲存。', zhHans: '设置已保存。', ko: '설정을 저장했습니다.' },
  'settings.saveFailed': { ja: '設定の保存に失敗しました。', en: 'Failed to save settings.', zhHant: '儲存設定失敗。', zhHans: '保存设置失败。', ko: '설정 저장에 실패했습니다.' },
  'profile.newTitle': { ja: 'プロファイルを作成', en: 'Create profile', zhHant: '建立設定檔', zhHans: '创建配置文件', ko: '프로필 만들기' },
  'profile.editTitle': { ja: 'プロファイルを編集', en: 'Edit profile', zhHant: '編輯設定檔', zhHans: '编辑配置文件', ko: '프로필 편집' },
  'profile.name': { ja: 'プロファイル名', en: 'Profile name', zhHant: '設定檔名稱', zhHans: '配置文件名称', ko: '프로필 이름' },
  'profile.namePlaceholder': { ja: '例: サバイバル', en: 'Example: Survival', zhHant: '例如：生存', zhHans: '例如：生存', ko: '예: 서바이벌' },
  'profile.minecraftVersion': { ja: 'Minecraft バージョン', en: 'Minecraft version', zhHant: 'Minecraft 版本', zhHans: 'Minecraft 版本', ko: 'Minecraft 버전' },
  'profile.includeSnapshots': { ja: 'スナップショットを表示', en: 'Show snapshots', zhHant: '顯示快照版本', zhHans: '显示快照版本', ko: '스냅샷 표시' },
  'profile.loaderBuild': { ja: 'ローダーバージョン', en: 'Loader version', zhHant: '載入器版本', zhHans: '加载器版本', ko: '로더 버전' },
  'profile.loaderLoading': { ja: 'ローダー情報を読み込んでいます...', en: 'Loading loader information...', zhHant: '正在載入載入器資訊...', zhHans: '正在加载加载器信息...', ko: '로더 정보를 불러오는 중...' },
  'profile.loaderUnavailable': { ja: '利用可能なローダーがありません。', en: 'No compatible loader is available.', zhHant: '沒有相容的載入器。', zhHans: '没有兼容的加载器。', ko: '호환되는 로더가 없습니다.' },
  'profile.loaderRequired': { ja: 'ローダーバージョンを選択してください。', en: 'Select a loader version.', zhHant: '請選擇載入器版本。', zhHans: '请选择加载器版本。', ko: '로더 버전을 선택하세요.' },
  'profile.javaSetting': { ja: 'Java 設定', en: 'Java setting', zhHant: 'Java 設定', zhHans: 'Java 设置', ko: 'Java 설정' },
  'profile.jvmArguments': { ja: '追加JVM引数', en: 'Additional JVM arguments', zhHant: '額外 JVM 引數', zhHans: '附加 JVM 参数', ko: '추가 JVM 인수' },
  'profile.jvmArgumentsPlaceholder': { ja: '例: -XX:+UseG1GC', en: 'Example: -XX:+UseG1GC', zhHant: '例如：-XX:+UseG1GC', zhHans: '例如：-XX:+UseG1GC', ko: '예: -XX:+UseG1GC' },
  'profile.memory': { ja: 'メモリ', en: 'Memory', zhHant: '記憶體', zhHans: '内存', ko: '메모리' },
  'profile.saved': { ja: 'プロファイルを保存しました。', en: 'Profile saved.', zhHant: '設定檔已儲存。', zhHans: '配置文件已保存。', ko: '프로필을 저장했습니다.' },
  'profile.deleted': { ja: 'プロファイルを削除しました。', en: 'Profile deleted.', zhHant: '設定檔已刪除。', zhHans: '配置文件已删除。', ko: '프로필을 삭제했습니다.' },
  'profile.nameRequired': { ja: 'プロファイル名を入力してください。', en: 'Enter a profile name.', zhHant: '請輸入設定檔名稱。', zhHans: '请输入配置文件名称。', ko: '프로필 이름을 입력하세요.' },
  'profile.snapshotWarning': { ja: 'Snapshot版は不安定な可能性があります。', en: 'Snapshot versions may be unstable.', zhHant: '快照版本可能不穩定。', zhHans: '快照版本可能不稳定。', ko: '스냅샷 버전은 불안정할 수 있습니다.' },
  'mods.title': { ja: 'Modrinth MOD', en: 'Modrinth mods', zhHant: 'Modrinth 模組', zhHans: 'Modrinth 模组', ko: 'Modrinth 모드' },
  'mods.description': { ja: '選択中のMinecraftバージョンとローダーに対応するMODを検索します。', en: 'Search for mods compatible with the selected Minecraft version and loader.', zhHant: '搜尋與所選 Minecraft 版本和載入器相容的模組。', zhHans: '搜索与所选 Minecraft 版本和加载器兼容的模组。', ko: '선택한 Minecraft 버전과 로더에 맞는 모드를 검색합니다.' },
  'mods.searchPlaceholder': { ja: 'MODを検索', en: 'Search mods', zhHant: '搜尋模組', zhHans: '搜索模组', ko: '모드 검색' },
  'mods.search': { ja: '検索', en: 'Search', zhHant: '搜尋', zhHans: '搜索', ko: '검색' },
  'mods.searching': { ja: '検索中...', en: 'Searching...', zhHant: '搜尋中...', zhHans: '搜索中...', ko: '검색 중...' },
  'mods.popularHint': { ja: '空欄では人気順に表示します。', en: 'Leave the search blank to browse popular mods.', zhHant: '留空即可依熱門程度瀏覽。', zhHans: '留空即可按热门程度浏览。', ko: '검색어를 비우면 인기순으로 표시합니다.' },
  'mods.addProfileFirst': { ja: 'MODを追加するには、先にプロファイルを保存してください。', en: 'Save the profile before adding mods.', zhHant: '新增模組前請先儲存設定檔。', zhHans: '添加模组前请先保存配置文件。', ko: '모드를 추가하기 전에 프로필을 저장하세요.' },
  'mods.noneInstalled': { ja: 'このインスタンスにインストール済みのMODはありません。', en: 'No mods are installed in this instance.', zhHant: '此執行個體尚未安裝模組。', zhHans: '此实例尚未安装模组。', ko: '이 인스턴스에 설치된 모드가 없습니다.' },
  'mods.selectLoader': { ja: 'MODローダーを選択するとMODを追加できます。', en: 'Select a mod loader to add mods.', zhHant: '選擇模組載入器後即可新增模組。', zhHans: '选择模组加载器后即可添加模组。', ko: '모드 로더를 선택하면 모드를 추가할 수 있습니다.' },
  'mods.installedLoadFailed': { ja: 'インストール済みMODを読み込めませんでした。', en: 'Failed to load installed mods.', zhHant: '無法載入已安裝的模組。', zhHans: '无法加载已安装的模组。', ko: '설치된 모드를 불러오지 못했습니다.' },
  'mods.loadingPopular': { ja: '人気MODを読み込んでいます...', en: 'Loading popular mods...', zhHant: '正在載入熱門模組...', zhHans: '正在加载热门模组...', ko: '인기 모드를 불러오는 중...' },
  'mods.popularFailed': { ja: '人気MODの取得に失敗しました。', en: 'Failed to load popular mods.', zhHant: '無法載入熱門模組。', zhHans: '无法加载热门模组。', ko: '인기 모드를 불러오지 못했습니다.' },
  'mods.noResults': { ja: '一致するMODがありません。', en: 'No matching mods found.', zhHant: '找不到相符的模組。', zhHans: '没有找到匹配的模组。', ko: '일치하는 모드가 없습니다.' },
  'mods.download': { ja: 'ダウンロード', en: 'Download', zhHant: '下載', zhHans: '下载', ko: '다운로드' },
  'mods.downloading': { ja: 'ダウンロード中...', en: 'Downloading...', zhHant: '下載中...', zhHans: '下载中...', ko: '다운로드 중...' },
  'mods.downloaded': { ja: '{name} をダウンロードしました。', en: 'Downloaded {name}.', zhHant: '已下載 {name}。', zhHans: '已下载 {name}。', ko: '{name} 다운로드를 완료했습니다.' },
  'mods.downloadFailed': { ja: 'MODのダウンロードに失敗しました。', en: 'Failed to download the mod.', zhHant: '模組下載失敗。', zhHans: '模组下载失败。', ko: '모드 다운로드에 실패했습니다.' },
  'logs.empty': { ja: 'ログはまだありません。', en: 'No logs yet.', zhHant: '尚無記錄。', zhHans: '暂无日志。', ko: '아직 로그가 없습니다.' },
  'auth.signedOut': { ja: '未ログイン', en: 'Signed out', zhHant: '未登入', zhHans: '未登录', ko: '로그아웃됨' },
  'auth.signIn': { ja: 'Microsoftでログイン', en: 'Sign in with Microsoft', zhHant: '使用 Microsoft 登入', zhHans: '使用 Microsoft 登录', ko: 'Microsoft로 로그인' },
  'auth.verified': { ja: 'Minecraft: Java Edition 認証済み', en: 'Minecraft: Java Edition verified', zhHant: 'Minecraft: Java Edition 已驗證', zhHans: 'Minecraft: Java Edition 已验证', ko: 'Minecraft: Java Edition 인증됨' },
  'auth.offlineAvailable': { ja: '認証済みオフライン起動が利用できます。シングルプレイ向けです。', en: 'Verified offline launch is available for single-player use.', zhHant: '可使用已驗證的離線啟動，僅建議單人遊戲。', zhHans: '可使用已验证的离线启动，仅建议单人游戏。', ko: '인증된 오프라인 실행을 사용할 수 있습니다. 싱글 플레이용입니다.' },
  'auth.deviceAvailable': { ja: 'Microsoftデバイスコードでログインできます', en: 'Microsoft device code sign-in is available', zhHant: '可使用 Microsoft 裝置代碼登入', zhHans: '可使用 Microsoft 设备代码登录', ko: 'Microsoft 장치 코드로 로그인할 수 있습니다' },
  'auth.notConfigured': { ja: 'このビルドにはMicrosoft認証設定がありません', en: 'Microsoft authentication is not configured in this build', zhHant: '此版本未設定 Microsoft 驗證', zhHans: '此版本未配置 Microsoft 身份验证', ko: '이 빌드에는 Microsoft 인증이 구성되지 않았습니다' },
  'auth.signInAccount': { ja: 'Microsoftアカウントでログイン', en: 'Sign in with a Microsoft account', zhHant: '使用 Microsoft 帳戶登入', zhHans: '使用 Microsoft 帐户登录', ko: 'Microsoft 계정으로 로그인' },
  'auth.configurationMissing': { ja: 'Microsoft認証が未設定です', en: 'Microsoft authentication is not configured', zhHant: '尚未設定 Microsoft 驗證', zhHans: '尚未配置 Microsoft 身份验证', ko: 'Microsoft 인증이 구성되지 않았습니다' },
  'auth.configurationHelp': { ja: '続行するにはEntra IDのクライアントIDを設定してください。', en: 'Configure an Entra ID client ID to continue.', zhHant: '請設定 Entra ID 用戶端識別碼以繼續。', zhHans: '请配置 Entra ID 客户端 ID 以继续。', ko: '계속하려면 Entra ID 클라이언트 ID를 구성하세요.' },
  'auth.logout': { ja: 'ログアウト', en: 'Sign out', zhHant: '登出', zhHans: '退出登录', ko: '로그아웃' },
  'auth.codeCopied': { ja: 'アクセス許可コードをコピーしました。', en: 'Authorization code copied.', zhHant: '已複製授權代碼。', zhHans: '已复制授权代码。', ko: '인증 코드를 복사했습니다.' },
  'auth.loginFailed': { ja: 'Microsoftログインに失敗しました。', en: 'Microsoft sign-in failed.', zhHant: 'Microsoft 登入失敗。', zhHans: 'Microsoft 登录失败。', ko: 'Microsoft 로그인에 실패했습니다.' },
  'auth.requestingCode': { ja: 'アクセス許可コードを発行しています...', en: 'Requesting an authorization code...', zhHant: '正在要求授權代碼...', zhHans: '正在请求授权代码...', ko: '인증 코드를 요청하는 중...' },
  'auth.codeExpires': { ja: '有効期限 {time}', en: 'Expires in {time}', zhHant: '有效期限 {time}', zhHans: '有效期 {time}', ko: '만료 {time}' },
  'auth.codeExpired': { ja: 'コードの有効期限が切れました', en: 'The code has expired', zhHant: '代碼已過期', zhHans: '代码已过期', ko: '코드가 만료되었습니다' },
  'auth.waiting': { ja: '認証を待っています...', en: 'Waiting for authentication...', zhHant: '正在等待驗證...', zhHans: '正在等待身份验证...', ko: '인증을 기다리는 중...' },
  'auth.connecting': { ja: 'Microsoftへ接続しています。', en: 'Connecting to Microsoft.', zhHant: '正在連線至 Microsoft。', zhHans: '正在连接 Microsoft。', ko: 'Microsoft에 연결하는 중입니다.' },
  'auth.complete': { ja: '認証完了', en: 'Authentication complete', zhHant: '驗證完成', zhHans: '身份验证完成', ko: '인증 완료' },
  'auth.loginSuccess': { ja: '{name}でログインしました。', en: 'Signed in as {name}.', zhHant: '已以 {name} 登入。', zhHans: '已以 {name} 登录。', ko: '{name}(으)로 로그인했습니다.' },
  'auth.cancelled': { ja: '認証キャンセル', en: 'Authentication cancelled', zhHant: '已取消驗證', zhHans: '已取消身份验证', ko: '인증 취소됨' },
  'auth.loggedOut': { ja: 'ログアウトしました。', en: 'Signed out.', zhHant: '已登出。', zhHans: '已退出登录。', ko: '로그아웃했습니다.' },
  'auth.logoutFailed': { ja: 'ログアウトできませんでした。', en: 'Failed to sign out.', zhHant: '登出失敗。', zhHans: '退出登录失败。', ko: '로그아웃하지 못했습니다.' },
  'auth.copyCodeFailed': { ja: 'コードをコピーできませんでした。', en: 'Failed to copy the code.', zhHant: '無法複製代碼。', zhHans: '无法复制代码。', ko: '코드를 복사하지 못했습니다.' },
  'auth.openPageFailed': { ja: '認証ページを開けませんでした。', en: 'Failed to open the authentication page.', zhHant: '無法開啟驗證頁面。', zhHans: '无法打开身份验证页面。', ko: '인증 페이지를 열지 못했습니다.' },
  'auth.cancelledToast': { ja: 'Microsoft認証をキャンセルしました。', en: 'Microsoft authentication was cancelled.', zhHant: '已取消 Microsoft 驗證。', zhHans: '已取消 Microsoft 身份验证。', ko: 'Microsoft 인증을 취소했습니다.' },
  'java.source.managed': { ja: 'ランチャー管理', en: 'Launcher managed', zhHant: '啟動器管理', zhHans: '启动器管理', ko: '런처 관리' },
  'java.source.custom': { ja: '手動追加', en: 'Manually added', zhHant: '手動新增', zhHans: '手动添加', ko: '수동 추가' },
  'java.source.system': { ja: 'システム', en: 'System', zhHant: '系統', zhHans: '系统', ko: '시스템' },
  'java.source.mojang': { ja: 'Mojang互換', en: 'Mojang compatible', zhHant: 'Mojang 相容', zhHans: 'Mojang 兼容', ko: 'Mojang 호환' },
  'java.verified': { ja: '検証済み', en: 'Verified', zhHant: '已驗證', zhHans: '已验证', ko: '검증됨' },
  'java.autoOption': { ja: '自動（推奨: Eclipse Temurin by Adoptium）', en: 'Automatic (recommended: Eclipse Temurin by Adoptium)', zhHant: '自動（建議：Eclipse Temurin by Adoptium）', zhHans: '自动（推荐：Eclipse Temurin by Adoptium）', ko: '자동(권장: Eclipse Temurin by Adoptium)' },
  'java.manualOption': { ja: '手動選択...', en: 'Choose manually...', zhHant: '手動選擇...', zhHans: '手动选择...', ko: '수동 선택...' },
  'java.autoDescription': { ja: 'Minecraftバージョンに応じて必要なJavaを自動選択・自動取得します。', en: 'Automatically selects and downloads Java required by the Minecraft version.', zhHant: '依 Minecraft 版本自動選擇並下載所需的 Java。', zhHans: '根据 Minecraft 版本自动选择并下载所需的 Java。', ko: 'Minecraft 버전에 필요한 Java를 자동으로 선택하고 다운로드합니다.' },
  'java.selectExecutable': { ja: 'Java実行ファイルを選択してください。', en: 'Select a Java executable.', zhHant: '請選擇 Java 執行檔。', zhHans: '请选择 Java 可执行文件。', ko: 'Java 실행 파일을 선택하세요.' },
  'java.selectFailed': { ja: 'Java実行ファイルを選択できませんでした。', en: 'Failed to select a Java executable.', zhHant: '無法選擇 Java 執行檔。', zhHans: '无法选择 Java 可执行文件。', ko: 'Java 실행 파일을 선택하지 못했습니다.' },
  'java.listFailed': { ja: 'Javaランタイム一覧を取得できませんでした。', en: 'Failed to load Java runtimes.', zhHant: '無法載入 Java 執行環境。', zhHans: '无法加载 Java 运行环境。', ko: 'Java 런타임 목록을 불러오지 못했습니다.' },
  'java.refreshing': { ja: 'Javaを再検出しています...', en: 'Rescanning Java runtimes...', zhHant: '正在重新掃描 Java...', zhHans: '正在重新扫描 Java...', ko: 'Java 런타임을 다시 검색하는 중...' },
  'java.added': { ja: 'Javaランタイムを追加しました。', en: 'Java runtime added.', zhHant: '已新增 Java 執行環境。', zhHans: '已添加 Java 运行环境。', ko: 'Java 런타임을 추가했습니다.' },
  'java.addFailed': { ja: 'Javaを追加できませんでした。', en: 'Failed to add Java.', zhHant: '無法新增 Java。', zhHans: '无法添加 Java。', ko: 'Java를 추가하지 못했습니다.' },
  'java.removed': { ja: 'Javaランタイムを削除しました。', en: 'Java runtime removed.', zhHant: '已移除 Java 執行環境。', zhHans: '已删除 Java 运行环境。', ko: 'Java 런타임을 삭제했습니다.' },
  'java.removeFailed': { ja: 'Javaを削除できませんでした。', en: 'Failed to remove Java.', zhHant: '無法移除 Java。', zhHans: '无法删除 Java。', ko: 'Java를 삭제하지 못했습니다.' },
  'java.installing': { ja: 'Javaをインストールしています...', en: 'Installing Java...', zhHant: '正在安裝 Java...', zhHans: '正在安装 Java...', ko: 'Java를 설치하는 중...' },
  'java.installed': { ja: 'Javaをインストールしました。', en: 'Java installed.', zhHant: 'Java 已安裝。', zhHans: 'Java 已安装。', ko: 'Java를 설치했습니다.' },
  'java.installFailed': { ja: 'Javaのインストールに失敗しました。', en: 'Java installation failed.', zhHant: 'Java 安裝失敗。', zhHans: 'Java 安装失败。', ko: 'Java 설치에 실패했습니다.' },
  'java.notFound': { ja: '利用可能なJavaが見つかりません。', en: 'No suitable Java runtime was found.', zhHant: '找不到合適的 Java 執行環境。', zhHans: '找不到合适的 Java 运行环境。', ko: '적합한 Java 런타임을 찾을 수 없습니다.' },
  'process.preparing': { ja: '準備中', en: 'Preparing', zhHant: '準備中', zhHans: '准备中', ko: '준비 중' },
  'process.launching': { ja: '起動中...', en: 'Launching...', zhHant: '啟動中...', zhHans: '启动中...', ko: '실행 중...' },
  'common.operationFailed': { ja: '処理に失敗しました。', en: 'The operation failed.', zhHant: '操作失敗。', zhHans: '操作失败。', ko: '작업에 실패했습니다.' },
  'common.openFolderFailed': { ja: 'フォルダを開けませんでした。', en: 'Failed to open the folder.', zhHant: '無法開啟資料夾。', zhHans: '无法打开文件夹。', ko: '폴더를 열지 못했습니다.' },
  'profiles.openLogsFailed': { ja: 'ログフォルダを開けませんでした。', en: 'Failed to open the log folder.', zhHant: '無法開啟記錄資料夾。', zhHans: '无法打开日志文件夹。', ko: '로그 폴더를 열지 못했습니다.' },
  'profiles.openLatestLogFailed': { ja: 'latest.logを開けませんでした。', en: 'Failed to open latest.log.', zhHant: '無法開啟 latest.log。', zhHans: '无法打开 latest.log。', ko: 'latest.log를 열지 못했습니다.' },
  'profiles.copyReproFailed': { ja: 'PowerShell再現スクリプトをコピーできませんでした。', en: 'Failed to copy the PowerShell reproduction script.', zhHant: '無法複製 PowerShell 重現指令碼。', zhHans: '无法复制 PowerShell 复现脚本。', ko: 'PowerShell 재현 스크립트를 복사하지 못했습니다.' },
  'profile.deleteFailed': { ja: 'プロファイルを削除できませんでした。', en: 'Failed to delete the profile.', zhHant: '無法刪除設定檔。', zhHans: '无法删除配置文件。', ko: '프로필을 삭제하지 못했습니다.' },
  'mods.selectLoaderFirst': { ja: 'MODを追加するにはMODローダーを選択してください。', en: 'Select a mod loader before adding mods.', zhHant: '新增模組前請選擇模組載入器。', zhHans: '添加模组前请选择模组加载器。', ko: '모드를 추가하려면 모드 로더를 선택하세요.' },
  'mods.searchFailed': { ja: 'MODを検索できませんでした。', en: 'Failed to search for mods.', zhHant: '無法搜尋模組。', zhHans: '无法搜索模组。', ko: '모드를 검색하지 못했습니다.' },
  'mods.noCompatibleVersion': { ja: 'このMinecraft版とMODローダーに対応するMODバージョンがありません。', en: 'No mod version supports this Minecraft version and loader.', zhHant: '沒有支援此 Minecraft 版本與載入器的模組版本。', zhHans: '没有支持此 Minecraft 版本和加载器的模组版本。', ko: '이 Minecraft 버전과 로더를 지원하는 모드 버전이 없습니다.' },
  'mods.addFailed': { ja: 'MODを追加できませんでした。', en: 'Failed to add the mod.', zhHant: '無法新增模組。', zhHans: '无法添加模组。', ko: '모드를 추가하지 못했습니다.' },
  'mods.removeFailed': { ja: 'MODを削除できませんでした。', en: 'Failed to remove the mod.', zhHant: '無法移除模組。', zhHans: '无法删除模组。', ko: '모드를 삭제하지 못했습니다.' },
  'settings.directoryUpdated': { ja: 'ゲームディレクトリを更新しました。', en: 'Game directory updated.', zhHant: '遊戲目錄已更新。', zhHans: '游戏目录已更新。', ko: '게임 디렉터리를 업데이트했습니다.' },
  'settings.directoryChangeFailed': { ja: 'フォルダーを変更できませんでした。', en: 'Failed to change the folder.', zhHant: '無法變更資料夾。', zhHans: '无法更改文件夹。', ko: '폴더를 변경하지 못했습니다.' },
  'process.working': { ja: '処理中...', en: 'Working...', zhHant: '處理中...', zhHans: '处理中...', ko: '처리 중...' },
  'settings.developerLogSaveFailed': { ja: '開発者ログ設定を保存できませんでした。', en: 'Failed to save the developer log setting.', zhHant: '無法儲存開發者記錄設定。', zhHans: '无法保存开发者日志设置。', ko: '개발자 로그 설정을 저장하지 못했습니다.' },
  'process.javaStarted': { ja: 'Javaプロセスを起動しました。', en: 'Java process started.', zhHant: 'Java 程序已啟動。', zhHans: 'Java 进程已启动。', ko: 'Java 프로세스를 시작했습니다.' },
  'process.clientInit': { ja: 'Minecraftクライアントの初期化ログを確認しました（画面表示は未確認）。', en: 'Minecraft client initialization log detected (window not confirmed).', zhHant: '已偵測 Minecraft 用戶端初始化記錄（尚未確認視窗）。', zhHans: '已检测 Minecraft 客户端初始化日志（尚未确认窗口）。', ko: 'Minecraft 클라이언트 초기화 로그를 확인했습니다(창은 미확인).' },
  'process.windowCandidate': { ja: 'Minecraftウィンドウ候補を検出しました。', en: 'Minecraft window candidate detected.', zhHant: '已偵測 Minecraft 視窗候選項目。', zhHans: '已检测到 Minecraft 窗口候选项。', ko: 'Minecraft 창 후보를 감지했습니다.' },
  'process.windowConfirmed': { ja: 'Minecraftウィンドウ表示を確認しました。', en: 'Minecraft window display confirmed.', zhHant: '已確認 Minecraft 視窗顯示。', zhHans: '已确认 Minecraft 窗口显示。', ko: 'Minecraft 창 표시를 확인했습니다.' },
  'process.playing': { ja: 'プレイ中', en: 'Playing', zhHant: '遊玩中', zhHans: '游戏中', ko: '플레이 중' },
  'process.windowUnverified': { ja: 'プロセスは起動していますが画面を確認できません。', en: 'The process is running, but no game window has been confirmed.', zhHant: '程序正在執行，但尚未確認遊戲視窗。', zhHans: '进程正在运行，但尚未确认游戏窗口。', ko: '프로세스가 실행 중이지만 게임 창은 확인되지 않았습니다.' },
  'process.windowlessExit': { ja: '画面未表示のまま終了しました。', en: 'The process exited without showing a game window.', zhHant: '程序已結束，但未顯示遊戲視窗。', zhHans: '进程已退出，但未显示游戏窗口。', ko: '게임 창을 표시하지 않고 프로세스가 종료되었습니다.' },
  'process.checkLogs': { ja: '設定パネルのログで詳細を確認できます。', en: 'See the Settings logs for details.', zhHant: '請在設定面板的記錄中查看詳細資訊。', zhHans: '请在设置面板的日志中查看详细信息。', ko: '설정 패널의 로그에서 자세한 내용을 확인하세요.' },
  'process.checkInstanceLogs': { ja: 'インスタンス起動ログとlatest.logを確認してください。', en: 'Check the instance launch log and latest.log.', zhHant: '請檢查執行個體啟動記錄與 latest.log。', zhHans: '请检查实例启动日志和 latest.log。', ko: '인스턴스 실행 로그와 latest.log를 확인하세요.' },
  'failure.authentication': { ja: '認証失敗', en: 'Authentication failed', zhHant: '驗證失敗', zhHans: '身份验证失败', ko: '인증 실패' },
  'failure.ownership': { ja: '所有権確認失敗', en: 'Ownership verification failed', zhHant: '擁有權驗證失敗', zhHans: '所有权验证失败', ko: '소유권 확인 실패' },
  'failure.download': { ja: 'ダウンロード失敗', en: 'Download failed', zhHant: '下載失敗', zhHans: '下载失败', ko: '다운로드 실패' },
  'failure.verification': { ja: 'ファイル検証失敗', en: 'File verification failed', zhHant: '檔案驗證失敗', zhHans: '文件验证失败', ko: '파일 검증 실패' },
  'failure.java': { ja: 'Java未検出', en: 'Java not found', zhHant: '找不到 Java', zhHans: '找不到 Java', ko: 'Java를 찾을 수 없음' },
  'failure.process': { ja: 'プロセス起動失敗', en: 'Process launch failed', zhHant: '程序啟動失敗', zhHans: '进程启动失败', ko: '프로세스 시작 실패' },
  'failure.crash': { ja: 'Minecraftクラッシュ', en: 'Minecraft crashed', zhHant: 'Minecraft 當機', zhHans: 'Minecraft 崩溃', ko: 'Minecraft 충돌' },
  'failure.arguments': { ja: '起動引数エラー', en: 'Launch argument error', zhHant: '啟動引數錯誤', zhHans: '启动参数错误', ko: '실행 인수 오류' },
  'failure.forge': { ja: 'Forge構築失敗', en: 'Forge setup failed', zhHant: 'Forge 建置失敗', zhHans: 'Forge 构建失败', ko: 'Forge 구성 실패' },
  'failure.fabric': { ja: 'Fabric構築失敗', en: 'Fabric setup failed', zhHant: 'Fabric 建置失敗', zhHans: 'Fabric 构建失败', ko: 'Fabric 구성 실패' },
  'failure.neoforge': { ja: 'NeoForge構築失敗', en: 'NeoForge setup failed', zhHant: 'NeoForge 建置失敗', zhHans: 'NeoForge 构建失败', ko: 'NeoForge 구성 실패' },
  'failure.windowUnverified': { ja: '画面表示未確認', en: 'Window display not confirmed', zhHant: '尚未確認視窗顯示', zhHans: '尚未确认窗口显示', ko: '창 표시 미확인' },
} satisfies Record<string, Message>;

export type TranslationKey = keyof typeof messages;

const messageProperty: Record<SupportedLanguage, keyof Message> = {
  ja: 'ja',
  en: 'en',
  'zh-Hant': 'zhHant',
  'zh-Hans': 'zhHans',
  ko: 'ko',
};

export const normalizeLanguagePreference = (value: unknown): LanguagePreference => {
  if (value === 'system' || supportedLanguages.includes(value as SupportedLanguage)) {
    return value as LanguagePreference;
  }
  return 'system';
};

export const detectSupportedLanguage = (
  languages: readonly string[] | undefined,
): SupportedLanguage => {
  for (const rawLanguage of languages ?? []) {
    const language = rawLanguage.trim().replaceAll('_', '-').toLowerCase();
    if (language === 'ja' || language.startsWith('ja-')) return 'ja';
    if (language === 'ko' || language.startsWith('ko-')) return 'ko';
    if (language === 'en' || language.startsWith('en-')) return 'en';
    if (language === 'zh' || language.startsWith('zh-')) {
      if (
        language.includes('hant') ||
        language.endsWith('-tw') ||
        language.endsWith('-hk') ||
        language.endsWith('-mo')
      ) {
        return 'zh-Hant';
      }
      return 'zh-Hans';
    }
  }
  return 'ja';
};

export const resolveLanguage = (
  preference: LanguagePreference,
  systemLanguages?: readonly string[],
): SupportedLanguage =>
  preference === 'system' ? detectSupportedLanguage(systemLanguages) : preference;

export const translate = (
  language: SupportedLanguage,
  key: TranslationKey,
  parameters: Record<string, string | number> = {},
): string => {
  const template = messages[key][messageProperty[language]];
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(parameters, name)
      ? String(parameters[name])
      : match,
  );
};

export const translationKeys = Object.keys(messages) as TranslationKey[];
