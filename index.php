<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    
    <title>NPad - Free Online Notepad | Rich Text Editor with Auto-Save</title>
    <meta name="description" content="Free online notepad with rich text editing, auto-save, dark mode.">
    
    <!-- Favicon -->
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📝</text></svg>">
    
    <!-- Preload critical resources -->
    <link rel="preload" href="/fonts/inter/Inter-Regular.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="/fonts/fontawesome/fa-solid-900.woff2" as="font" type="font/woff2" crossorigin>
    
    <!-- Critical inline CSS -->
    <style>
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background-color: #e0e0e0;
            margin: 0;
            padding: 50px 30px;
            display: flex;
            flex-direction: column;
            align-items: center;
            min-height: 100vh;
        }
        .editor-wrapper {
            max-width: 900px;
            width: 100%;
            background: rgba(255,255,255,0.2);
            border-radius: 16px;
            padding: 10px;
        }
        #toolbar button {
            min-width: 30px;
            height: 30px;
        }
    </style>
    
    <link rel="stylesheet" href="/css/fontawesome-custom.css?v=<?php echo filemtime('css/fontawesome-custom.css'); ?>">
    <link rel="stylesheet" href="style.css?v=<?php echo filemtime('style.css'); ?>">
    
    <!-- SEO -->
    <link rel="canonical" href="https://npad.ir/">
</head>

<body>
    <!-- Blobs -->
    <div class="blob blob-1"></div>
    <div class="blob blob-2"></div>
    <div class="blob blob-3"></div>
    
    <!-- Loading Indicator -->
    <div class="lang-loading" id="langLoading">
        <i class="fas fa-circle-notch fa-spin"></i> Loading...
    </div>
    
    <!-- Language Toggle -->
    <div class="lang-toggle-container">
        <div class="lang-toggle">
            <button class="lang-btn" data-lang="en" id="btnEn">English</button>
            <button class="lang-btn" data-lang="fa" id="btnFa">فارسی</button>
        </div>
    </div>

    <!-- Navbar -->
    <nav id="navbar" role="navigation" aria-label="Main navigation">
        <div style="display: flex;">
            <div class="dropdown">
                <button class="dropbtn">File</button>
                <div class="dropdown-content">
                    <a href="#" onclick="newFile(); return false;">New</a>
                    <a href="#" onclick="openFile(); return false;">Open</a>
                    <a href="#" onclick="saveFile(); return false;">Save TXT</a>
                    <a href="#" onclick="printFile(); return false;">Print</a>
                    <a href="#" onclick="showDetails(); return false;">Details</a>
                </div>
            </div>
            <div class="dropdown">
                <button class="dropbtn" aria-haspopup="true" aria-expanded="false">Edit</button>
                <div class="dropdown-content" role="menu">
                    <a href="#" onclick="copyText(); return false;" role="menuitem">Copy</a>
                    <a href="#" onclick="cutText(); return false;" role="menuitem">Cut</a>
                    <a href="#" onclick="pasteText(); return false;" role="menuitem">Paste</a>
                    <a href="#" onclick="pasteWithoutFormatting(); return false;" role="menuitem">Paste Plain</a>
                    <a href="#" onclick="selectAll(); return false;" role="menuitem">Select All</a>
                </div>
            </div>
        </div>
        <div class="dark-mode-toggle">
            <i class="fas fa-moon" aria-hidden="true"></i>
            <input type="checkbox" id="darkModeToggle" aria-label="Toggle dark mode">
            <label for="darkModeToggle"></label>
        </div>
    </nav>
    
    <!-- Main Editor -->
    <main class="editor-wrapper" role="main">
        <div id="toolbar" role="toolbar" aria-label="Text formatting toolbar">
            <span class="button-group">
                <select id="fontSelect" aria-label="Select font">
                    <option value="Inter">Inter</option>
                    <option value="Arial">Arial</option>
                    <option value="Verdana">Verdana</option>
                    <option value="Tahoma">Tahoma</option>
                    <option value="Georgia">Georgia</option>
                    <option value="Times New Roman">Times New Roman</option>
                    <option value="Courier New">Courier New</option>
                    <option value="Lucida Sans Unicode">Lucida Sans Unicode</option>
                    <option value="Trebuchet MS">Trebuchet MS</option>
                    <option value="Palatino Linotype">Palatino Linotype</option>
                    <option value="Garamond">Garamond</option>
                    <option value="Vazirmatn">وزیرمتن - Vazirmatn</option>
                    <option value="Amiri">امیری - Amiri</option>
                    <option value="Lateef">لطیف - Lateef</option>
                </select>
                <select id="sizeSelect" aria-label="Select font size">
                    <option value="1">10px</option>
                    <option value="2">13px</option>
                    <option value="3" selected>16px</option>
                    <option value="4">18px</option>
                    <option value="5">24px</option>
                    <option value="6">32px</option>
                    <option value="7">48px</option>
                </select>
            </span>
            <span class="button-group">
                <button id="boldBtn" title="Bold" aria-label="Bold"><i class="fa-solid fa-bold"></i></button>
                <button id="italicBtn" title="Italic" aria-label="Italic"><i class="fa-solid fa-italic"></i></button>
                <button id="underlineBtn" title="Underline" aria-label="Underline"><i class="fa-solid fa-underline"></i></button>
                <button id="strikeBtn" title="Strikethrough" aria-label="Strikethrough"><i class="fa-solid fa-strikethrough"></i></button>
                <button id="subscriptBtn" title="Subscript" aria-label="Subscript"><i class="fa-solid fa-subscript"></i></button>
                <button id="superscriptBtn" title="Superscript" aria-label="Superscript"><i class="fa-solid fa-superscript"></i></button>
            </span>
            <span class="button-group">
                <button id="bulletListBtn" title="Bullet List" aria-label="Bullet List"><i class="fa-solid fa-list-ul"></i></button>
                <button id="orderedListBtn" title="Ordered List" aria-label="Ordered List"><i class="fa-solid fa-list-ol"></i></button>
            </span>
            <span class="button-group">
                <button id="alignLeftBtn" title="Align Left" aria-label="Align Left"><i class="fa-solid fa-align-left"></i></button>
                <button id="alignCenterBtn" title="Align Center" aria-label="Align Center"><i class="fa-solid fa-align-center"></i></button>
                <button id="alignRightBtn" title="Align Right" aria-label="Align Right"><i class="fa-solid fa-align-right"></i></button>
                <button id="alignJustifyBtn" title="Justify" aria-label="Justify"><i class="fa-solid fa-align-justify"></i></button>
            </span>
            <span class="button-group">
                <label for="foreColorInput" title="Text Color" style="display: flex; align-items: center; cursor: pointer; padding: 5px;">
                    <span style="display: flex; align-items: center; justify-content: center; width: 20px; height: 20px;">
                        <i class="fa-solid fa-palette"></i>
                    </span>
                    <input type="color" id="foreColorInput" value="#333333" aria-label="Text color">
                </label>
                <label for="backColorInput" title="Highlight Color" style="display: flex; align-items: center; cursor: pointer; padding: 5px;">
                    <span style="display: flex; align-items: center; justify-content: center; width: 20px; height: 20px;">
                        <i class="fa-solid fa-fill-drip"></i>
                    </span>
                    <input type="color" id="backColorInput" value="#FFFF00" aria-label="Highlight color">
                </label>
            </span>
            <span class="button-group">
                <button id="undoBtn" title="Undo" aria-label="Undo"><i class="fa-solid fa-undo"></i></button>
                <button id="redoBtn" title="Redo" aria-label="Redo"><i class="fa-solid fa-redo"></i></button>
            </span>
            <span class="button-group">
                <button id="indentBtn" title="Increase Indent" aria-label="Increase Indent"><i class="fa-solid fa-indent"></i></button>
                <button id="outdentBtn" title="Decrease Indent" aria-label="Decrease Indent"><i class="fa-solid fa-outdent"></i></button>
            </span>
            <span class="button-group">
                <button id="createLinkBtn" title="Insert Link" aria-label="Insert Link"><i class="fa-solid fa-link"></i></button>
            </span>
            <span class="button-group">
                <button id="removeFormatBtn" title="Clear Formatting" aria-label="Clear Formatting"><i class="fa-solid fa-eraser"></i></button>
            </span>
        </div>
        
        <div id="editor" contenteditable="true" data-placeholder="Start typing here..." role="textbox" aria-multiline="true" aria-label="Text editor"></div>
        
        <div id="wordCountDisplay" role="status" aria-live="polite">
            Words: 0 - Characters: 0 | Selected words: 0 - Selected characters: 0
        </div>
        
        <!-- Modal -->
        <div id="customModal" class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-message">
            <div class="modal-content">
                <span class="close" aria-label="Close">&times;</span>
                <p id="modal-message">Message</p>
                <div id="modal-actions">
                    <button id="modal-confirm">Confirm</button>
                    <button id="modal-cancel">Cancel</button>
                </div>
            </div>
        </div>
    </main>

    <!-- SEO Content Section - ENGLISH -->
    <section class="seo-section content-en">
        <div class="seo-hero glass">
            <h1>NPad - Your Free Online Notepad</h1>
            <p>
                A powerful, <strong>free online notepad</strong> that works directly in your browser. 
                Format text, create lists, insert links - all saved automatically. No registration required, 
                no downloads, just open and start typing.
            </p>
        </div>
        
        <h2 class="section-title">Why Choose NPad?</h2>
        <p style="line-height: 1.8; color: var(--text); margin-bottom: 16px; font-size: 16px;">
            Unlike basic text editors, NPad offers advanced formatting options while maintaining simplicity. 
            Your notes are automatically saved to your browser's storage, ensuring you never lose your work. 
            Whether you're a student, professional, or writer, NPad is your perfect companion.
        </p>
        
        <h2 class="section-title">Key Features</h2>
        <div class="features-grid">
            <div class="feature-card">
                <span class="feature-icon"><i class="fas fa-save"></i></span>
                <div class="feature-title">Auto-Save Technology</div>
                <p class="feature-desc">Never lose your work with automatic browser storage that saves every change in real-time</p>
            </div>
            <div class="feature-card">
                <span class="feature-icon"><i class="fas fa-magic"></i></span>
                <div class="feature-title">Rich Text Formatting</div>
                <p class="feature-desc">Bold, italic, underline, strikethrough, subscript, and superscript options at your fingertips</p>
            </div>
            <div class="feature-card">
                <span class="feature-icon"><i class="fas fa-moon"></i></span>
                <div class="feature-title">Beautiful Dark Mode</div>
                <p class="feature-desc">Easy on the eyes with our stunning dark theme featuring animated liquid backgrounds</p>
            </div>
            <div class="feature-card">
                <span class="feature-icon"><i class="fas fa-lock"></i></span>
                <div class="feature-title">Privacy First</div>
                <p class="feature-desc">All data stored locally in your browser - no server uploads, no tracking, complete privacy</p>
            </div>
            <div class="feature-card">
                <span class="feature-icon"><i class="fas fa-bolt"></i></span>
                <div class="feature-title">No Registration</div>
                <p class="feature-desc">Start typing immediately, no sign-up, no email, no hassle - just pure productivity</p>
            </div>
            <div class="feature-card">
                <span class="feature-icon"><i class="fas fa-mobile-alt"></i></span>
                <div class="feature-title">Fully Responsive</div>
                <p class="feature-desc">Works perfectly on desktop, tablet, and mobile devices for note-taking on the go</p>
            </div>
        </div>

        <h2 class="section-title">Perfect For Every Use Case</h2>
        <div class="features-grid">
            <div class="feature-card">
                <span class="feature-icon"><i class="fas fa-graduation-cap"></i></span>
                <div class="feature-title">Students</div>
                <p class="feature-desc">Take lecture notes, create study guides, organize research materials, and prepare for exams</p>
            </div>
            <div class="feature-card">
                <span class="feature-icon"><i class="fas fa-briefcase"></i></span>
                <div class="feature-title">Professionals</div>
                <p class="feature-desc">Draft emails, create meeting notes, write quick documents, and brainstorm ideas</p>
            </div>
            <div class="feature-card">
                <span class="feature-icon"><i class="fas fa-pen-fancy"></i></span>
                <div class="feature-title">Writers</div>
                <p class="feature-desc">Write blog posts, articles, stories, poems, and any creative content with style</p>
            </div>
        </div>

        <h2 class="section-title">Frequently Asked Questions</h2>
        <div class="faq-container">
            <div class="faq-item">
                <div class="faq-question" onclick="toggleFaq(this)">
                    <span>Is NPad really free?</span>
                    <i class="fas fa-chevron-down faq-icon"></i>
                </div>
                <div class="faq-answer">
                    <p>Yes! NPad is completely free with no hidden costs, no ads, and no premium tiers. All features are available to everyone, forever.</p>
                </div>
            </div>
            <div class="faq-item">
                <div class="faq-question" onclick="toggleFaq(this)">
                    <span>Is my data secure and private?</span>
                    <i class="fas fa-chevron-down faq-icon"></i>
                </div>
                <div class="faq-answer">
                    <p>Absolutely. Your notes never leave your browser - everything is stored locally on your device using IndexedDB. We don't collect, store, or have access to your data.</p>
                </div>
            </div>
            <div class="faq-item">
                <div class="faq-question" onclick="toggleFaq(this)">
                    <span>Can I access my notes on different devices?</span>
                    <i class="fas fa-chevron-down faq-icon"></i>
                </div>
                <div class="faq-answer">
                    <p>Currently, notes are stored per browser on each device. You can easily export your notes as TXT files and import them on another device to continue working.</p>
                </div>
            </div>
            <div class="faq-item">
                <div class="faq-question" onclick="toggleFaq(this)">
                    <span>Does NPad work offline?</span>
                    <i class="fas fa-chevron-down faq-icon"></i>
                </div>
                <div class="faq-answer">
                    <p>Yes! Once the page is loaded, NPad works completely offline with all features available. Your notes are saved locally and don't require an internet connection.</p>
                </div>
            </div>
            <div class="faq-item">
                <div class="faq-question" onclick="toggleFaq(this)">
                    <span>What file formats can I export to?</span>
                    <i class="fas fa-chevron-down faq-icon"></i>
                </div>
                <div class="faq-answer">
                    <p>Currently, NPad supports exporting to TXT (plain text) format and direct printing to PDF through your browser's print function.</p>
                </div>
            </div>
            <div class="faq-item">
                <div class="faq-question" onclick="toggleFaq(this)">
                    <span>Is there a character or word limit?</span>
                    <i class="fas fa-chevron-down faq-icon"></i>
                </div>
                <div class="faq-answer">
                    <p>No artificial limits! The only limitation is your browser's storage capacity, which is typically several megabytes - enough for thousands of pages of text.</p>
                </div>
            </div>
        </div>

        <div class="cta-section">
            <p class="cta-text">
                Start using NPad today and experience the simplicity of a powerful online notepad that respects your privacy 
                and enhances your productivity. Whether you need a quick scratchpad or a full-featured text editor, 
                NPad is your go-to solution for all your note-taking needs.
            </p>
            <a href="#editor" class="cta-button" onclick="document.getElementById('editor').focus(); return false;">
                Start Writing Now <i class="fas fa-arrow-up"></i>
            </a>
        </div>
    </section>

    <!-- SEO Content Section - PERSIAN -->
    <section class="seo-section content-fa" dir="rtl">
        <div class="seo-hero glass">
            <h1>NPad - دفترچه یادداشت آنلاین و رایگان شما</h1>
            <p>
                یک <strong>دفترچه یادداشت آنلاین و رایگان</strong> قدرتمند که مستقیماً در مرورگر شما کار می‌کند. 
                متن‌ها را قالب‌بندی کنید، لیست بسازید و لینک اضافه کنید - همه چیز به‌طور خودکار ذخیره می‌شود. 
                بدون نیاز به ثبت‌نام، بدون دانلود، فقط باز کنید و شروع به تایپ کنید.
            </p>
        </div>
        
        <h2 class="section-title">چرا NPad را انتخاب کنیم؟</h2>
        <p style="line-height: 1.8; color: var(--text); margin-bottom: 16px; font-size: 16px;">
            برخلاف ویرایشگرهای متن ساده، NPad امکانات پیشرفته قالب‌بندی را در عین سادگی ارائه می‌دهد. 
            یادداشت‌های شما به‌طور خودکار در حافظه مرورگر ذخیره می‌شوند تا هرگز نگران از دست رفتن نوشته‌های خود نباشید. 
            چه دانشجو باشید، چه متخصص یا نویسنده، NPad همراهی ایده‌آل برای شماست.
        </p>
        
        <h2 class="section-title">ویژگی‌های کلیدی</h2>
        <div class="features-grid">
            <div class="feature-card">
                <span class="feature-icon"><i class="fas fa-save"></i></span>
                <div class="feature-title">تکنولوژی ذخیره خودکار</div>
                <p class="feature-desc">با ذخیره‌سازی محلی در مرورگر که هر تغییر را در لحظه ثبت می‌کند، هرگز کارهای خود را از دست ندهید</p>
            </div>
            <div class="feature-card">
                <span class="feature-icon"><i class="fas fa-magic"></i></span>
                <div class="feature-title">قالب‌بندی متن پیشرفته</div>
                <p class="feature-desc">امکاناتی نظیر درشت‌نویسی (Bold)، کج‌نویسی، زیرخط‌دار کردن، خط‌خوردگی و اندیس‌های بالا و پایین در دسترس شماست</p>
            </div>
            <div class="feature-card">
                <span class="feature-icon"><i class="fas fa-moon"></i></span>
                <div class="feature-title">حالت تیره زیبا</div>
                <p class="feature-desc">با تم دارک خیره‌کننده و پس‌زمینه‌های متحرک مایع، از چشمان خود محافظت کنید</p>
            </div>
            <div class="feature-card">
                <span class="feature-icon"><i class="fas fa-lock"></i></span>
                <div class="feature-title">اولویت با حریم خصوصی</div>
                <p class="feature-desc">تمام داده‌ها به صورت محلی در مرورگر شما ذخیره می‌شوند؛ بدون آپلود در سرور، بدون ردیابی و با حفظ کامل حریم خصوصی</p>
            </div>
            <div class="feature-card">
                <span class="feature-icon"><i class="fas fa-bolt"></i></span>
                <div class="feature-title">بدون نیاز به ثبت‌نام</div>
                <p class="feature-desc">بلافاصله شروع به تایپ کنید؛ بدون عضویت، بدون نیاز به ایمیل و بدون دردسر - فقط بهره‌وری خالص</p>
            </div>
            <div class="feature-card">
                <span class="feature-icon"><i class="fas fa-mobile-alt"></i></span>
                <div class="feature-title">کاملاً واکنش‌گرا</div>
                <p class="feature-desc">برای یادداشت‌برداری در هر مکان، به‌خوبی روی دسکتاپ، تبلت و گوشی‌های موبایل کار می‌کند</p>
            </div>
        </div>

        <h2 class="section-title">مناسب برای هر کاربردی</h2>
        <div class="features-grid">
            <div class="feature-card">
                <span class="feature-icon"><i class="fas fa-graduation-cap"></i></span>
                <div class="feature-title">دانشجویان</div>
                <p class="feature-desc">یادداشت‌برداری از کلاس‌ها، ایجاد راهنمای مطالعه، سازماندهی منابع تحقیق و آماده‌سازی برای امتحانات</p>
            </div>
            <div class="feature-card">
                <span class="feature-icon"><i class="fas fa-briefcase"></i></span>
                <div class="feature-title">متخصصان</div>
                <p class="feature-desc">پیش‌نویس ایمیل‌ها، ثبت صورت‌جلسات، نوشتن مستندات سریع و طوفان فکری برای ایده‌های جدید</p>
            </div>
            <div class="feature-card">
                <span class="feature-icon"><i class="fas fa-pen-fancy"></i></span>
                <div class="feature-title">نویسندگان</div>
                <p class="feature-desc">نوشتن پست‌های وبلاگ، مقالات، داستان، شعر و هرگونه محتوای خلاقانه با استایلی زیبا</p>
            </div>
        </div>

        <h2 class="section-title">سوالات متداول</h2>
        <div class="faq-container">
            <div class="faq-item">
                <div class="faq-question" onclick="toggleFaq(this)">
                    <span>آیا NPad واقعاً رایگان است؟</span>
                    <i class="fas fa-chevron-down faq-icon"></i>
                </div>
                <div class="faq-answer">
                    <p>بله! NPad کاملاً رایگان است؛ بدون هزینه‌های پنهان، بدون تبلیغات و بدون نسخه‌های پولی. تمام ویژگی‌ها برای همیشه در دسترس همگان است.</p>
                </div>
            </div>
            <div class="faq-item">
                <div class="faq-question" onclick="toggleFaq(this)">
                    <span>آیا داده‌های من ایمن و خصوصی هستند؟</span>
                    <i class="fas fa-chevron-down faq-icon"></i>
                </div>
                <div class="faq-answer">
                    <p>قطعاً. یادداشت‌های شما هرگز از مرورگرتان خارج نمی‌شوند. همه چیز با استفاده از IndexedDB به صورت محلی روی دستگاه شما ذخیره می‌شود. ما هیچ دسترسی به داده‌های شما نداریم.</p>
                </div>
            </div>
            <div class="faq-item">
                <div class="faq-question" onclick="toggleFaq(this)">
                    <span>آیا می‌توانم در دستگاه‌های مختلف به یادداشت‌هایم دسترسی داشته باشم؟</span>
                    <i class="fas fa-chevron-down faq-icon"></i>
                </div>
                <div class="faq-answer">
                    <p>در حال حاضر، یادداشت‌ها به ازای هر مرورگر در هر دستگاه ذخیره می‌شوند. شما می‌توانید به راحتی یادداشت‌های خود را با فرمت TXT خروجی بگیرید و در دستگاه دیگری وارد کنید.</p>
                </div>
            </div>
            <div class="faq-item">
                <div class="faq-question" onclick="toggleFaq(this)">
                    <span>آیا NPad به صورت آفلاین کار می‌کند؟</span>
                    <i class="fas fa-chevron-down faq-icon"></i>
                </div>
                <div class="faq-answer">
                    <p>بله! پس از یک بار بارگذاری صفحه، NPad به صورت کاملاً آفلاین و با تمام امکانات کار می‌کند. یادداشت‌های شما به صورت محلی ذخیره شده و نیازی به اتصال اینترنت ندارند.</p>
                </div>
            </div>
            <div class="faq-item">
                <div class="faq-question" onclick="toggleFaq(this)">
                    <span>از چه فرمت‌هایی می‌توانم خروجی بگیرم؟</span>
                    <i class="fas fa-chevron-down faq-icon"></i>
                </div>
                <div class="faq-answer">
                    <p>در حال حاضر NPad از خروجی با فرمت TXT (متن ساده) و چاپ مستقیم به PDF از طریق قابلیت پرینت مرورگر پشتیبانی می‌کند.</p>
                </div>
            </div>
            <div class="faq-item">
                <div class="faq-question" onclick="toggleFaq(this)">
                    <span>آیا محدودیت تعداد کلمات یا کاراکتر وجود دارد؟</span>
                    <i class="fas fa-chevron-down faq-icon"></i>
                </div>
                <div class="faq-answer">
                    <p>هیچ محدودیت مصنوعی وجود ندارد! تنها محدودیت، ظرفیت ذخیره‌سازی مرورگر شماست که معمولاً چندین مگابایت است و برای هزاران صفحه متن کافی می‌باشد.</p>
                </div>
            </div>
        </div>

        <div class="cta-section">
            <p class="cta-text">
                همین امروز استفاده از NPad را شروع کنید و سادگیِ یک دفترچه یادداشت آنلاین قدرتمند را تجربه کنید که به حریم خصوصی شما احترام می‌گذارد. چه به یک فضای سریع برای یادداشت نیاز داشته باشید و چه به یک ویرایشگر متن کامل، NPad بهترین گزینه برای شماست.
            </p>
            <a href="#editor" class="cta-button" onclick="document.getElementById('editor').focus(); return false;">
                همین حالا نوشتن را شروع کنید <i class="fas fa-arrow-up"></i>
            </a>
        </div>
    </section>

    <footer class="seo-footer">
        <p>&copy; 2025 NPad.ir - Free Online Notepad | All rights reserved</p>
        <div class="footer-links">
            <a href="https://npad.ir">Home</a>
            <a href="mailto:alirezashabanzadeh01@gmail.com">Contact</a>
            <a href="#" onclick="alert('Privacy Policy: All data is stored locally in your browser. We do not collect or store any personal information.'); return false;">Privacy</a>
        </div>
    </footer>

    <script src="scripts.js?v=<?php echo filemtime('scripts.js'); ?>"></script>

    
    <!-- Inline Scripts for FAQ and Language -->
    <script>
        // =============================================
        // FAQ Toggle Function
        // =============================================
        function toggleFaq(element) {
            var faqItem = element.closest('.faq-item');
            var allFaqs = document.querySelectorAll('.faq-item');
            
            allFaqs.forEach(function(item) {
                if (item !== faqItem) {
                    item.classList.remove('active');
                }
            });
            
            faqItem.classList.toggle('active');
        }

        // =============================================
        // Language Detection and Toggle System
        // =============================================
        (function() {
            var FALLBACK_LANG = 'en';
            
            function getSavedLang() {
                try {
                    return localStorage.getItem('npad_lang') || null;
                } catch (e) {
                    return null;
                }
            }
            
            function saveLang(lang) {
                try {
                    localStorage.setItem('npad_lang', lang);
                } catch (e) {}
            }
            
            function isPersianCountry(countryCode) {
                var persianCountries = ['IR', 'AF', 'TJ'];
                return countryCode && persianCountries.indexOf(countryCode.toUpperCase()) !== -1;
            }
            
            function getBrowserLanguage() {
                var browserLang = navigator.language || navigator.userLanguage || '';
                return (browserLang.indexOf('fa') === 0 || browserLang.indexOf('per') === 0) ? 'fa' : 'en';
            }
            
            function setLanguage(lang) {
                document.body.setAttribute('data-lang', lang);
                
                document.querySelectorAll('.lang-btn').forEach(function(btn) {
                    btn.classList.remove('active');
                });
                
                var activeBtn = document.querySelector('.lang-btn[data-lang="' + lang + '"]');
                if (activeBtn) {
                    activeBtn.classList.add('active');
                }
                
                saveLang(lang);
                document.documentElement.lang = lang === 'fa' ? 'fa' : 'en';
            }
            
            function detectCountry() {
                return new Promise(function(resolve) {
                    var completed = false;
                    
                    setTimeout(function() {
                        if (!completed) {
                            completed = true;
                            resolve(null);
                        }
                    }, 3000);
                    
                    fetch('https://ipwho.is/')
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (!completed && data.country_code) {
                                completed = true;
                                resolve(data.country_code);
                            }
                        })
                        .catch(function() {
                            fetch('https://api.country.is/')
                                .then(function(r) { return r.json(); })
                                .then(function(data) {
                                    if (!completed && data.country) {
                                        completed = true;
                                        resolve(data.country);
                                    }
                                })
                                .catch(function() {
                                    if (!completed) {
                                        completed = true;
                                        resolve(null);
                                    }
                                });
                        });
                });
            }
            
            function initLanguage() {
                var savedLang = getSavedLang();
                var loading = document.getElementById('langLoading');
                
                if (savedLang) {
                    setLanguage(savedLang);
                    if (loading) loading.style.display = 'none';
                    return;
                }
                
                if (loading) loading.style.display = 'block';
                
                detectCountry().then(function(countryCode) {
                    var defaultLang = FALLBACK_LANG;
                    
                    if (countryCode && isPersianCountry(countryCode)) {
                        defaultLang = 'fa';
                    } else if (!countryCode) {
                        defaultLang = getBrowserLanguage();
                    }
                    
                    setLanguage(defaultLang);
                    if (loading) loading.style.display = 'none';
                });
            }
            
            // Wait for DOM
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', init);
            } else {
                init();
            }
            
            function init() {
                // Language buttons
                var btnEn = document.getElementById('btnEn');
                var btnFa = document.getElementById('btnFa');
                
                if (btnEn) btnEn.addEventListener('click', function() { setLanguage('en'); });
                if (btnFa) btnFa.addEventListener('click', function() { setLanguage('fa'); });
                
                // Initialize language
                initLanguage();
            }
        })();
    </script>
</body>
</html>