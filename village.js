// ==========================================
// SIMULATION D'UNE BASE DE DONNÉES LOCALE
// ==========================================
let baseDeDonnees = JSON.parse(localStorage.getItem('village_citoyens')) || [];
let utilisateurActif = null;

const supabaseConfig = window.VILLAGE_SUPABASE_CONFIG || {};
const SUPABASE_URL = supabaseConfig.url || '';
const SUPABASE_ANON_KEY = supabaseConfig.anonKey || '';
const PHOTO_BUCKET = 'citoyen-photos';
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const LOCAL_PHOTO_PREFIX = 'local-photo:';
const PHOTO_DATABASE_NAME = 'village_photo_storage';
const isFileProtocol = window.location.protocol === 'file:';
const authSessionStorage = {
    getItem(key) {
        return sessionStorage.getItem(key) || localStorage.getItem(key);
    },
    setItem(key, value) {
        const remember = document.getElementById('remember-login')?.checked ?? true;
        const targetStorage = remember ? localStorage : sessionStorage;
        const otherStorage = remember ? sessionStorage : localStorage;
        targetStorage.setItem(key, value);
        otherStorage.removeItem(key);
    },
    removeItem(key) {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
    }
};
const supabaseClient = !isFileProtocol && window.supabase?.createClient &&
    SUPABASE_URL && SUPABASE_ANON_KEY
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            persistSession: true,
            storage: authSessionStorage
        }
    })
    : null;

// Variable pour savoir si on est en train de modifier quelqu'un (stocke son ID)
let idEnCoursDeModification = null;

// Éléments du DOM
const form = document.getElementById('recensement-form');
const btnImprimer = document.getElementById('btn-imprimer');
const btnAdmin = document.getElementById('btn-admin');
const btnGenerer = document.getElementById('btn-generer');
const photoInput = document.getElementById('photo-citoyen');
const photoPreviewContainer = document.getElementById('photo-preview-container');
const photoPreview = document.getElementById('photo-preview');
const receiptPhoto = document.getElementById('receipt-photo');
const userLoginForm = document.getElementById('user-login-form');
const userRegisterForm = document.getElementById('user-register-form');
const userWelcome = document.getElementById('user-welcome');
const btnLogout = document.getElementById('btn-logout');
const btnShowLogin = document.getElementById('btn-show-login');
const btnShowRegister = document.getElementById('btn-show-register');
const siteNav = document.querySelector('.site-nav');
const siteNavToggle = document.querySelector('.site-nav-toggle');
const btnForgotPassword = document.getElementById('btn-forgot-password');
const rememberLogin = document.getElementById('remember-login');
const loginCard = document.querySelector('.auth-login-card');
const registerCard = document.querySelector('.auth-register');
const loginUserError = document.getElementById('login-user-error');
const registerUserError = document.getElementById('register-user-error');
const loginOfflineActions = document.getElementById('login-offline-actions');
const btnLoginRetry = document.getElementById('btn-login-retry');
const btnCreateLocalAccount = document.getElementById('btn-create-local-account');
let forceLocalRegistration = false;

// Zones de texte de la carte de reçu
const recuId = document.getElementById('recu-id');
const recuNomComplet = document.getElementById('recu-nom-complet');
const recuNaissance = document.getElementById('recu-naissance');
const recuParents = document.getElementById('recu-parents');
const recuClan = document.getElementById('recu-clan');
const recuConjoint = document.getElementById('recu-conjoint');
const recuEnfants = document.getElementById('recu-enfants');
const recuBiens = document.getElementById('recu-biens');
const recuSang = document.getElementById('recu-sang');
const recuDateDuJour = document.getElementById('recu-date-du-jour');

// Initialiser la date du jour sur le reçu
const aujourdhui = new Date();
recuDateDuJour.innerText = aujourdhui.toLocaleDateString('fr-FR');
let photoObjectUrl = null;
const storedPhotoObjectUrls = new Set();

function getLocalUsers() {
    try {
        return JSON.parse(localStorage.getItem('village_users')) || [];
    } catch (error) {
        return [];
    }
}

function saveLocalUsers(users) {
    localStorage.setItem('village_users', JSON.stringify(users));
}

function getLocalSession() {
    try {
        return JSON.parse(sessionStorage.getItem('village_user_session')) ||
            JSON.parse(localStorage.getItem('village_user_session')) ||
            null;
    } catch (error) {
        return null;
    }
}

function setLocalSession(user) {
    const storage = rememberLogin.checked ? localStorage : sessionStorage;
    const otherStorage = rememberLogin.checked ? sessionStorage : localStorage;
    storage.setItem('village_user_session', JSON.stringify(user));
    otherStorage.removeItem('village_user_session');
}

function clearLocalSession() {
    localStorage.removeItem('village_user_session');
    sessionStorage.removeItem('village_user_session');
}

function createLocalUserRecord({ email, password, fullName, birthDate, phone }) {
    return {
        id: `local-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        email: email.toLowerCase(),
        password,
        user_metadata: {
            full_name: fullName,
            birth_date: birthDate,
            phone
        },
        created_at: new Date().toISOString()
    };
}

function isNetworkError(error) {
    const message = String(error?.message || error || '');
    return error instanceof TypeError ||
        /failed to fetch|networkerror|network request failed|load failed/i.test(message);
}

function getErrorMessage(error, fallback) {
    if (isNetworkError(error)) {
        return 'Le service en ligne est indisponible. Vérifiez votre connexion ou réessayez.';
    }
    return error?.message || fallback;
}

async function requestCitizensApi(method, citizen) {
    const headers = { 'Content-Type': 'application/json' };
    if (method === 'POST') {
        if (!supabaseClient) {
            throw new Error('La connexion Supabase est nécessaire pour enregistrer un citoyen en ligne.');
        }
        const { data, error } = await supabaseClient.auth.getSession();
        if (error) throw error;
        if (!data.session?.access_token) {
            throw new Error('Votre session a expiré. Reconnectez-vous pour continuer.');
        }
        headers.Authorization = `Bearer ${data.session.access_token}`;
    }

    const response = await fetch('/.netlify/functions/citizens', {
        method,
        credentials: 'same-origin',
        headers,
        ...(citizen ? { body: JSON.stringify(citizen) } : {})
    });
    let result;
    try {
        result = await response.json();
    } catch (error) {
        throw new Error('Réponse invalide du service de recensement.');
    }
    if (!response.ok) {
        throw new Error(result.message || 'Le service de recensement a refusé la demande.');
    }
    return result;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

function registerLocalUser({ email, password, fullName, birthDate, phone }) {
    const users = getLocalUsers();
    if (users.some(user => user.email === email)) {
        throw new Error('Un compte avec cet email existe déjà.');
    }

    const user = createLocalUserRecord({ email, password, fullName, birthDate, phone });
    users.push(user);
    saveLocalUsers(users);
    setLocalSession(user);
    showAppForUser(user);
    return user;
}

function authenticateLocalUser(email, password) {
    const user = getLocalUsers().find(item => item.email === email && item.password === password);
    if (!user) {
        const error = new Error('Aucun compte local ne correspond à ces identifiants.');
        error.code = 'LOCAL_ACCOUNT_NOT_FOUND';
        throw error;
    }

    setLocalSession(user);
    showAppForUser(user);
    return user;
}

// ==========================================
// FONCTIONS DE NOTIFICATION (SANS ALERT)
// ==========================================

// Affiche un toast de notification
function showToast(message, type = 'success', duration = 4000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icons = {
        success: '✅',
        error: '❌',
        info: 'ℹ️',
        warning: '⚠️'
    };
    
    toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-remove');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function setPhotoPreview(url) {
    if (!url) {
        photoPreview.removeAttribute('src');
        photoPreviewContainer.classList.add('hidden');
        return;
    }

    photoPreview.src = url;
    photoPreviewContainer.classList.remove('hidden');
}

function setReceiptPhoto(url) {
    if (!url) {
        receiptPhoto.removeAttribute('src');
        receiptPhoto.classList.add('hidden');
        return;
    }

    receiptPhoto.src = url;
    receiptPhoto.classList.remove('hidden');
}

function releasePhotoObjectUrl() {
    if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl);
    photoObjectUrl = null;
}

function openPhotoDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(PHOTO_DATABASE_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('photos');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function savePhotoLocally(filePath, file) {
    const database = await openPhotoDatabase();
    await new Promise((resolve, reject) => {
        const transaction = database.transaction('photos', 'readwrite');
        transaction.objectStore('photos').put(file, filePath);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

async function getLocalPhoto(filePath) {
    const database = await openPhotoDatabase();
    return new Promise((resolve, reject) => {
        const request = database.transaction('photos', 'readonly').objectStore('photos').get(filePath);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

async function removeLocalPhoto(filePath) {
    const database = await openPhotoDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction('photos', 'readwrite');
        transaction.objectStore('photos').delete(filePath);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

async function uploadCitizenPhoto(file, citizenId) {
    if (!utilisateurActif) {
        throw new Error('Connectez-vous pour enregistrer une photo.');
    }

    const allowedTypes = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp'
    };
    const extension = allowedTypes[file.type];

    if (!extension) {
        throw new Error('Choisissez une image JPEG, PNG ou WebP.');
    }
    if (file.size > MAX_PHOTO_SIZE) {
        throw new Error('La photo ne doit pas dépasser 5 Mo.');
    }

    const uniqueSuffix = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const filePath = `${utilisateurActif.id}/${citizenId}-${uniqueSuffix}.${extension}`;

    if (!supabaseClient) {
        const localFilePath = `${LOCAL_PHOTO_PREFIX}${filePath}`;
        try {
            await savePhotoLocally(localFilePath, file);
        } catch (storageError) {
            throw new Error(`Stockage local indisponible : ${storageError.message || 'erreur IndexedDB'}`);
        }
        showToast('Le stockage Supabase n’est pas disponible : la photo est enregistrée localement.', 'warning', 7000);
        return localFilePath;
    }

    let error;
    try {
        ({ error } = await supabaseClient.storage
            .from(PHOTO_BUCKET)
            .upload(filePath, file, { contentType: file.type, upsert: false }));
    } catch (uploadError) {
        if (!isNetworkError(uploadError)) throw uploadError;
        const localFilePath = `${LOCAL_PHOTO_PREFIX}${filePath}`;
        await savePhotoLocally(localFilePath, file);
        showToast('Connexion indisponible : la photo est enregistrée sur cet appareil.', 'warning', 7000);
        return localFilePath;
    }

    if (error && /bucket not found/i.test(error.message || '')) {
        const localFilePath = `${LOCAL_PHOTO_PREFIX}${filePath}`;
        try {
            await savePhotoLocally(localFilePath, file);
        } catch (storageError) {
            throw new Error(`Bucket Supabase introuvable et stockage local indisponible : ${storageError.message || 'erreur IndexedDB'}`);
        }
        showToast('Bucket Supabase absent : la photo est enregistrée sur cet appareil uniquement.', 'warning', 7000);
        return localFilePath;
    }
    if (error) throw error;
    return filePath;
}

async function getCitizenPhotoUrl(filePath) {
    if (!filePath) return null;

    if (filePath.startsWith(LOCAL_PHOTO_PREFIX)) {
        const photo = await getLocalPhoto(filePath);
        if (!photo) return null;
        const objectUrl = URL.createObjectURL(photo);
        storedPhotoObjectUrls.add(objectUrl);
        return objectUrl;
    }
    if (!supabaseClient) return null;

    let data;
    let error;
    try {
        ({ data, error } = await supabaseClient.storage
            .from(PHOTO_BUCKET)
            .createSignedUrl(filePath, 60 * 60));
    } catch (requestError) {
        if (!isNetworkError(requestError)) throw requestError;
        showToast('Connexion indisponible : aperçu photo momentanément inaccessible.', 'warning');
        return null;
    }

    if (error) {
        showToast('La photo est enregistrée, mais son aperçu n’a pas pu être chargé.', 'warning');
        return null;
    }
    return data.signedUrl;
}

async function deleteCitizenPhoto(filePath) {
    if (!filePath) return;

    if (filePath.startsWith(LOCAL_PHOTO_PREFIX)) {
        try {
            await removeLocalPhoto(filePath);
        } catch (error) {
            showToast('La photo locale n’a pas pu être supprimée.', 'warning');
        }
        return;
    }
    if (!supabaseClient) return;

    const { error } = await supabaseClient.storage.from(PHOTO_BUCKET).remove([filePath]);
    if (error) showToast('La photo n’a pas pu être supprimée du stockage.', 'warning');
}

window.addEventListener('pagehide', () => {
    storedPhotoObjectUrls.forEach(objectUrl => URL.revokeObjectURL(objectUrl));
});

photoInput.addEventListener('change', function() {
    const file = photoInput.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > MAX_PHOTO_SIZE) {
        showToast('Choisissez une image JPEG, PNG ou WebP de 5 Mo maximum.', 'error');
        photoInput.value = '';
        return;
    }

    releasePhotoObjectUrl();
    photoObjectUrl = URL.createObjectURL(file);
    setPhotoPreview(photoObjectUrl);
});

function showSupabaseConfigurationError(errorElement) {
    errorElement.textContent = 'Service Supabase non configuré. Renseignez SUPABASE_URL et SUPABASE_ANON_KEY dans les variables Netlify, puis redéployez.';
    errorElement.classList.remove('hidden');
}

function showAppForUser(user) {
    utilisateurActif = user;
    const displayName = user.user_metadata?.full_name || user.full_name || user.email || 'Utilisateur';
    userWelcome.textContent = `Bienvenue, ${displayName}`;
    userWelcome.classList.remove('hidden');
    btnLogout.classList.remove('hidden');
    document.getElementById('auth-page').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');

    if (user?.id?.startsWith('local-')) {
        setLocalSession(user);
    }
}

function showAuthPage() {
    userWelcome.classList.add('hidden');
    btnLogout.classList.add('hidden');
    document.getElementById('app-container').classList.add('hidden');
    document.getElementById('auth-page').classList.remove('hidden');
}

async function initializeUserSession() {
    const localSession = isFileProtocol ? getLocalSession() : null;
    if (localSession) {
        showAppForUser(localSession);
        return;
    }

    if (!supabaseClient) {
        showAuthPage();
        return;
    }

    try {
        const { data, error } = await supabaseClient.auth.getSession();
        if (error) throw error;

        if (data.session?.user) {
            showAppForUser(data.session.user);
        } else {
            showAuthPage();
        }
    } catch (error) {
        showAuthPage();
        if (!isNetworkError(error)) {
            showToast(getErrorMessage(error, 'Impossible de vérifier la session.'), 'error');
        }
    }
}

if (supabaseClient) {
    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
            showAppForUser(session.user);
        } else if (event === 'SIGNED_OUT') {
            utilisateurActif = null;
            showAuthPage();
        }
    });
}

userRegisterForm.addEventListener('submit', async function(event) {
    event.preventDefault();
    registerUserError.classList.add('hidden');

    const fullName = document.getElementById('register-nom-complet').value.trim();
    const birthDate = document.getElementById('register-date-naissance').value;
    const phone = document.getElementById('register-telephone').value.trim();
    const email = document.getElementById('register-email').value.trim().toLowerCase();
    const password = document.getElementById('register-password').value;

    if (!fullName || !birthDate || !phone || !email || !password) {
        registerUserError.textContent = 'Tous les champs sont requis pour l’inscription.';
        registerUserError.classList.remove('hidden');
        return;
    }

    const submitButton = document.getElementById('btn-user-register-submit');
    submitButton.disabled = true;

    try {
        if (forceLocalRegistration && isFileProtocol) {
            registerLocalUser({ email, password, fullName, birthDate, phone });
            forceLocalRegistration = false;
            showToast('Compte local créé sur cet appareil. Bienvenue !', 'info');
            userRegisterForm.reset();
            return;
        }

        if (!supabaseClient) {
            if (isFileProtocol) {
                registerLocalUser({ email, password, fullName, birthDate, phone });
                showToast('Compte local créé sur cet appareil. Bienvenue !', 'info');
                userRegisterForm.reset();
                return;
            }
            showSupabaseConfigurationError(registerUserError);
            return;
        }

        const emailRedirectTo = new URL(window.location.href);
        emailRedirectTo.search = '';
        emailRedirectTo.hash = '';

        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: {
                emailRedirectTo: emailRedirectTo.toString(),
                data: {
                    full_name: fullName,
                    birth_date: birthDate,
                    phone
                }
            }
        });

        if (error) throw error;

        if (data.session?.user) {
            showAppForUser(data.session.user);
            showToast('Inscription confirmée. Bienvenue !');
            userRegisterForm.reset();
            return;
        }

        userRegisterForm.reset();
        showToast('Inscription créée. Ouvrez le lien de confirmation envoyé par email, puis connectez-vous.', 'info', 7000);
    } catch (error) {
        if (isNetworkError(error) && isFileProtocol) {
            try {
                registerLocalUser({ email, password, fullName, birthDate, phone });
                userRegisterForm.reset();
                showToast('Service en ligne indisponible : votre compte est enregistré sur cet appareil.', 'warning', 7000);
                return;
            } catch (localError) {
                registerUserError.textContent = localError.message;
            }
        } else {
            registerUserError.textContent = getErrorMessage(error, 'Échec de l’inscription. Réessayez.');
        }
        registerUserError.classList.remove('hidden');
    } finally {
        submitButton.disabled = false;
    }
});

userLoginForm.addEventListener('submit', async function(event) {
    event.preventDefault();
    loginUserError.classList.add('hidden');
    loginOfflineActions.classList.add('hidden');

    const email = document.getElementById('login-user-email').value.trim().toLowerCase();
    const password = document.getElementById('login-user-password').value;

    if (!email || !password) {
        loginUserError.textContent = 'Veuillez saisir votre Gmail et votre mot de passe.';
        loginUserError.classList.remove('hidden');
        return;
    }

    const submitButton = document.getElementById('btn-user-login-submit');
    submitButton.disabled = true;

    try {
        if (!supabaseClient && isFileProtocol) {
            authenticateLocalUser(email, password);
            closeUserLoginModal();
            showToast('Connexion réussie. Bienvenue !');
            return;
        }
        if (!supabaseClient) {
            showSupabaseConfigurationError(loginUserError);
            return;
        }

        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;

        closeUserLoginModal();
        showToast('Connexion réussie. Bienvenue !');
        showAppForUser(data.user);
    } catch (error) {
        if (isNetworkError(error) && isFileProtocol) {
            try {
                authenticateLocalUser(email, password);
                closeUserLoginModal();
                showToast('Connexion locale réussie.', 'warning');
                return;
            } catch (localError) {
                if (localError.code !== 'LOCAL_ACCOUNT_NOT_FOUND') {
                    loginUserError.textContent = getErrorMessage(localError, 'Connexion impossible.');
                    loginUserError.classList.remove('hidden');
                    return;
                }
            }
        }

        if (isNetworkError(error) || error.code === 'LOCAL_ACCOUNT_NOT_FOUND') {
            loginUserError.textContent = isFileProtocol
                ? 'Aucun compte local ne correspond à ces identifiants.'
                : 'Le service de connexion est momentanément indisponible. Réessayez plus tard.';
            loginOfflineActions.classList.toggle('hidden', !isFileProtocol);
            btnLoginRetry.classList.add('hidden');
        } else {
            loginUserError.textContent = getErrorMessage(error, 'Identifiant ou mot de passe incorrect.');
        }
        loginUserError.classList.remove('hidden');
    } finally {
        submitButton.disabled = false;
    }
});

btnShowLogin.addEventListener('click', function() {
    openUserLoginModal();
});

btnShowRegister.addEventListener('click', function() {
    showRegistrationPage();
});

siteNavToggle.addEventListener('click', function() {
    const isExpanded = siteNavToggle.getAttribute('aria-expanded') === 'true';
    siteNavToggle.setAttribute('aria-expanded', String(!isExpanded));
    siteNavToggle.setAttribute('aria-label', isExpanded ? 'Ouvrir le menu' : 'Fermer le menu');
    siteNav.classList.toggle('is-open', !isExpanded);
});

siteNav.querySelectorAll('.site-nav-link, .site-nav-brand').forEach(link => {
    link.addEventListener('click', function() {
        siteNav.classList.remove('is-open');
        siteNavToggle.setAttribute('aria-expanded', 'false');
        siteNavToggle.setAttribute('aria-label', 'Ouvrir le menu');
    });
});

document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape' && siteNav.classList.contains('is-open')) {
        siteNav.classList.remove('is-open');
        siteNavToggle.setAttribute('aria-expanded', 'false');
        siteNavToggle.setAttribute('aria-label', 'Ouvrir le menu');
        siteNavToggle.focus();
    }
});

btnLoginRetry.addEventListener('click', function() {
    loginOfflineActions.classList.add('hidden');
    userLoginForm.requestSubmit();
});

btnCreateLocalAccount.addEventListener('click', function() {
    const email = document.getElementById('login-user-email').value.trim().toLowerCase();
    forceLocalRegistration = true;
    document.getElementById('register-email').value = email;
    showRegistrationPage();
    document.getElementById('register-nom-complet').focus();
    showToast('Complétez le formulaire pour créer un compte local, disponible sur cet appareil uniquement.', 'info', 7000);
});

btnForgotPassword.addEventListener('click', async function() {
    const email = document.getElementById('login-user-email').value.trim().toLowerCase();
    loginUserError.classList.add('hidden');

    if (!email) {
        loginUserError.textContent = 'Saisissez votre adresse e-mail pour recevoir un lien de réinitialisation.';
        loginUserError.classList.remove('hidden');
        document.getElementById('login-user-email').focus();
        return;
    }

    if (!supabaseClient) {
        loginUserError.textContent = 'La réinitialisation par e-mail nécessite une connexion au service en ligne. Les comptes locaux ne peuvent pas réinitialiser leur mot de passe ici.';
        loginUserError.classList.remove('hidden');
        return;
    }

    btnForgotPassword.disabled = true;
    try {
        const redirectTo = new URL(window.location.href);
        redirectTo.search = '';
        redirectTo.hash = '';
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: redirectTo.toString()
        });
        if (error) throw error;
        showToast('Si cette adresse possède un compte, un lien de réinitialisation lui sera envoyé.', 'info', 7000);
    } catch (error) {
        loginUserError.textContent = getErrorMessage(error, 'Impossible d’envoyer le lien de réinitialisation.');
        loginUserError.classList.remove('hidden');
    } finally {
        btnForgotPassword.disabled = false;
    }
});

btnLogout.addEventListener('click', async function() {
    if (!supabaseClient) {
        clearLocalSession();
        utilisateurActif = null;
        showAuthPage();
        showToast('Vous êtes déconnecté.');
        return;
    }

    try {
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;
    } catch (error) {
        if (!isNetworkError(error)) {
            showToast(getErrorMessage(error, 'La déconnexion a échoué. Réessayez.'), 'error');
            return;
        }
    }

    clearLocalSession();
    utilisateurActif = null;
    showAuthPage();
    showToast('Vous êtes déconnecté.');
});

initializeUserSession();

function openUserLoginModal() {
    loginCard.classList.remove('hidden');
    registerCard.classList.add('hidden');
    loginUserError.classList.add('hidden');
    loginOfflineActions.classList.add('hidden');
    btnLoginRetry.classList.toggle('hidden', !supabaseClient);
    document.getElementById('login-user-email').focus();
}

function closeUserLoginModal() {
    loginUserError.classList.add('hidden');
    loginOfflineActions.classList.add('hidden');
}

function showRegistrationPage() {
    loginCard.classList.add('hidden');
    registerCard.classList.remove('hidden');
    registerUserError.classList.add('hidden');
    document.getElementById('register-nom-complet').focus();
}

// Affiche une modale de confirmation (retourne une Promise)
function showConfirm(title, message) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('confirm-modal');
        document.getElementById('confirm-title').textContent = title;
        document.getElementById('confirm-message').textContent = message;
        overlay.classList.remove('hidden');

        const handleYes = () => {
            overlay.classList.add('hidden');
            cleanup();
            resolve(true);
        };

        const handleNo = () => {
            overlay.classList.add('hidden');
            cleanup();
            resolve(false);
        };

        const cleanup = () => {
            document.getElementById('btn-confirm-yes').removeEventListener('click', handleYes);
            document.getElementById('btn-confirm-no').removeEventListener('click', handleNo);
        };

        document.getElementById('btn-confirm-yes').addEventListener('click', handleYes);
        document.getElementById('btn-confirm-no').addEventListener('click', handleNo);
    });
}

// Ouvre la modale de connexion
function openLoginModal() {
    const overlay = document.getElementById('login-modal');
    const emailInput = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    const errorMsg = document.getElementById('login-error');
    
    emailInput.value = '';
    passwordInput.value = '';
    errorMsg.classList.add('hidden');
    overlay.classList.remove('hidden');
    
    setTimeout(() => emailInput.focus(), 100);

    return new Promise((resolve) => {
        const handleSubmit = async () => {
            const email = emailInput.value.trim();
            const password = passwordInput.value;

            if (!email || !password) {
                errorMsg.textContent = 'Saisissez votre adresse e-mail et votre mot de passe administrateur.';
                errorMsg.classList.remove('hidden');
                return;
            }

            const submitButton = document.getElementById('btn-login-submit');
            submitButton.disabled = true;
            errorMsg.classList.add('hidden');

            try {
                const response = await fetch('/.netlify/functions/admin-auth', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });

                if (!response.ok) {
                    const result = await response.json().catch(() => ({}));
                    if (response.status === 503) {
                        throw new Error('L’authentification administrateur n’est pas encore configurée dans Netlify.');
                    }
                    if (response.status === 401) {
                        throw new Error('Identifiants administrateur incorrects.');
                    }
                    throw new Error(result.message || 'Connexion administrateur impossible. Réessayez.');
                }

                overlay.classList.add('hidden');
                cleanup();
                resolve(true);
            } catch (error) {
                errorMsg.textContent = isNetworkError(error)
                    ? 'Connexion sécurisée indisponible. Ouvrez le site hébergé sur Netlify et réessayez.'
                    : error.message || 'Connexion administrateur impossible.';
                errorMsg.classList.remove('hidden');
                passwordInput.value = '';
                passwordInput.focus();
            } finally {
                submitButton.disabled = false;
            }
        };

        const handleCancel = () => {
            overlay.classList.add('hidden');
            cleanup();
            resolve(false);
        };

        const handleKeydown = (e) => {
            if (e.key === 'Enter') handleSubmit();
            if (e.key === 'Escape') handleCancel();
        };

        const cleanup = () => {
            document.getElementById('btn-login-submit').removeEventListener('click', handleSubmit);
            document.getElementById('btn-login-cancel').removeEventListener('click', handleCancel);
            document.removeEventListener('keydown', handleKeydown);
        };

        document.getElementById('btn-login-submit').addEventListener('click', handleSubmit);
        document.getElementById('btn-login-cancel').addEventListener('click', handleCancel);
        document.addEventListener('keydown', handleKeydown);
    });
}

// ==========================================
// 1. DYNAMISME : LIEN FORMULAIRE -> REÇU (ENREGISTRER OU MODIFIER)
// ==========================================
form.addEventListener('submit', async function(e) {
    e.preventDefault();
    btnGenerer.disabled = true;
    let uploadedPhotoPath = null;
    let citizenSaved = false;

    try {
        const citoyenExistant = idEnCoursDeModification
            ? baseDeDonnees.find(citoyen => citoyen.id === idEnCoursDeModification)
            : null;
        const idUnique = citoyenExistant?.id ||
            `VIL-${aujourdhui.getFullYear()}-${window.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12).toUpperCase() ||
                Math.floor(1000 + Math.random() * 9000)}`;
        const photoFile = photoInput.files?.[0];

        if (photoFile) {
            uploadedPhotoPath = await uploadCitizenPhoto(photoFile, idUnique);
        }

        const photoPath = uploadedPhotoPath || citoyenExistant?.photoPath || null;
        const citoyenStocke = {
            id: idUnique,
            nom: document.getElementById('nom').value.toUpperCase(),
            postnom: document.getElementById('postnom').value.toUpperCase(),
            prenom: document.getElementById('prenom').value,
            dateNaissance: document.getElementById('date-naissance').value,
            lieuNaissance: document.getElementById('lieu-naissance').value,
            nomPere: document.getElementById('nom-pere').value,
            nomMere: document.getElementById('nom-mere').value,
            nomFamille: document.getElementById('nom-famille').value || 'Non spécifié',
            statutMatrimonial: document.getElementById('statut-matrimonial').value,
            nomConjoint: document.getElementById('nom-conjoint').value || 'Aucun(e)',
            nomsEnfants: document.getElementById('noms-enfants').value || 'Aucun',
            biens: document.getElementById('biens').value || 'Aucun bien déclaré',
            telephone: document.getElementById('telephone').value || 'Non renseigné',
            groupeSanguin: document.getElementById('groupe-sanguin').value,
            photoPath,
            dateEnregistrement: aujourdhui.toLocaleDateString('fr-FR')
        };

        let citoyenEnregistre = citoyenStocke;
        if (!isFileProtocol) {
            const result = await requestCitizensApi(citoyenExistant ? 'PUT' : 'POST', citoyenStocke);
            citoyenEnregistre = result.citizen;
        }
        baseDeDonnees = baseDeDonnees.filter(citoyen => citoyen.id !== idUnique);
        baseDeDonnees.push(citoyenEnregistre);
        if (isFileProtocol) {
            localStorage.setItem('village_citoyens', JSON.stringify(baseDeDonnees));
        }
        citizenSaved = true;

        recuId.innerText = idUnique;
        recuNomComplet.innerText = `${citoyenStocke.nom} ${citoyenStocke.postnom} ${citoyenStocke.prenom}`;
        recuNaissance.innerText = `${new Date(citoyenStocke.dateNaissance).toLocaleDateString('fr-FR')} à ${citoyenStocke.lieuNaissance}`;
        recuParents.innerText = `${citoyenStocke.nomPere} & ${citoyenStocke.nomMere}`;
        recuClan.innerText = citoyenStocke.nomFamille;
        recuConjoint.innerText = citoyenStocke.statutMatrimonial === 'marie' ? citoyenStocke.nomConjoint : 'Célibataire / Non applicable';
        recuEnfants.innerText = citoyenStocke.nomsEnfants;
        recuBiens.innerText = citoyenStocke.biens;
        recuSang.innerText = citoyenStocke.groupeSanguin;

        const photoUrl = await getCitizenPhotoUrl(photoPath);
        setReceiptPhoto(photoUrl);
        setPhotoPreview(null);
        releasePhotoObjectUrl();
        photoInput.value = '';

        if (citoyenExistant?.photoPath && citoyenExistant.photoPath !== photoPath) {
            await deleteCitizenPhoto(citoyenExistant.photoPath);
        }

        if (citoyenExistant) {
            showToast('Citoyen modifié avec succès dans le registre ! Reçu mis à jour.', 'success');
            btnGenerer.innerText = 'Générer le Reçu';
            btnGenerer.style.background = 'linear-gradient(45deg, #d4af37, #aa8417)';
            idEnCoursDeModification = null;
        } else {
            showToast('Succès ! Citoyen enregistré. Vous pouvez imprimer son reçu.', 'success');
        }

        form.reset();
    } catch (error) {
        if (uploadedPhotoPath && !citizenSaved) await deleteCitizenPhoto(uploadedPhotoPath);
        showToast(getErrorMessage(error, 'Impossible d’enregistrer le citoyen et sa photo.'), 'error');
    } finally {
        btnGenerer.disabled = false;
    }
});

// ==========================================
// 2. ENVOI DES INFORMATIONS À L'IMPRIMANTE
// ==========================================
btnImprimer.addEventListener('click', async function() {
    if (recuId.innerText === "--------") {
        showToast("Veuillez d'abord charger ou générer un reçu avant d'imprimer.", 'warning');
        return;
    }

    const citoyen = baseDeDonnees.find(enregistrement => enregistrement.id === recuId.innerText);
    if (citoyen?.photoPath) {
        const photoUrl = await getCitizenPhotoUrl(citoyen.photoPath);
        if (photoUrl) {
            setReceiptPhoto(photoUrl);
            try {
                await receiptPhoto.decode();
            } catch (error) {
                showToast('La photo ne peut pas être chargée pour l’impression.', 'warning');
            }
        }
    }
    window.print();
});

// ==========================================
// 3. INTERVALLE ADMINISTRATEUR PRINCIPAL
// ==========================================
btnAdmin.addEventListener('click', async function() {
    const authenticated = await openLoginModal();
    if (authenticated) {
        ouvrirEspaceAdmin();
    }
});

async function ouvrirEspaceAdmin() {
    const ancienneFenetre = document.getElementById('modale-admin');
    if (ancienneFenetre) ancienneFenetre.remove();

    let donneesActuelles;
    try {
        if (isFileProtocol) {
            donneesActuelles = JSON.parse(localStorage.getItem('village_citoyens')) || [];
        } else {
            const result = await requestCitizensApi('GET');
            donneesActuelles = result.citizens;
            baseDeDonnees = donneesActuelles;
        }
    } catch (error) {
        showToast(getErrorMessage(error, 'Impossible de charger le registre depuis Neon.'), 'error');
        return;
    }

    const modale = document.createElement('div');
    modale.id = "modale-admin";
    modale.className = "admin-overlay";
    
    modale.style.position = "fixed";
    modale.style.top = "0";
    modale.style.left = "0";
    modale.style.width = "100%";
    modale.style.height = "100%";
    modale.style.backgroundColor = "rgba(15, 19, 25, 0.98)";
    modale.style.zIndex = "2000";
    modale.style.padding = "clamp(12px, 4vw, 40px)";
    modale.style.overflowY = "auto";
    modale.style.color = "#ffffff";

    let htmlContenu = `
        <div style="max-width: 1200px; margin: 0 auto;">
            <div class="admin-topbar" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #d4af37; padding-bottom: 20px; margin-bottom: 30px;">
                <h2 style="color: #d4af37; margin: 0;">Tableau de Bord Administrateur — Registre du Village</h2>
                <button id="close-admin" style="background: #d4af37; color: #111622; border: none; padding: 10px 20px; font-weight: bold; border-radius: 5px; cursor: pointer;">Fermer l'Espace</button>
            </div>
            <p style="margin-bottom: 20px; color: #a0aec0;">Total des citoyens recensés : <strong>${donneesActuelles.length}</strong></p>
    `;

    if (donneesActuelles.length === 0) {
        htmlContenu += `<p style="text-align: center; color: #a0aec0; padding: 40px; border: 1px dashed rgba(255,255,255,0.1); border-radius: 10px;">Aucun citoyen n'est enregistré pour le moment.</p>`;
    } else {
        htmlContenu += `<div class="admin-citizen-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 500px), 1fr)); gap: 20px;">`;

        donneesActuelles.forEach((citoyen, index) => {
            const statutLabel = citoyen.statutMatrimonial === "marie" ? "Marié(e)" : citoyen.statutMatrimonial === "celibataire" ? "Célibataire" : "Veuf(ve)";
            htmlContenu += `
                <article class="admin-citizen-card" style="background: rgba(26, 35, 51, 0.8); border: 1px solid rgba(212,175,55,0.2); border-radius: 12px; padding: 20px; position: relative;">
                    <div class="admin-citizen-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid rgba(212,175,55,0.3); padding-bottom: 12px; margin-bottom: 12px;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            ${citoyen.photoPath
                                ? `<img data-citizen-photo="${escapeHtml(citoyen.id)}" alt="Photo de ${escapeHtml(citoyen.nom)} ${escapeHtml(citoyen.prenom)}" style="width: 64px; height: 76px; object-fit: cover; border: 1px solid #d4af37; border-radius: 6px; background: #111622;">`
                                : `<div style="width: 64px; height: 76px; display: grid; place-items: center; border: 1px dashed rgba(212,175,55,0.45); border-radius: 6px; color: #a0aec0; font-size: 11px; text-align: center;">Sans photo</div>`}
                            <span style="font-family: monospace; color: #d4af37; font-weight: bold; font-size: 14px;">🆔 ${escapeHtml(citoyen.id)}</span>
                        </div>
                        <div>
                            <button onclick="chargerCitoyenPourModification('${escapeHtml(citoyen.id)}')" style="background: #3b82f6; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; margin-right: 5px;">✏️ Modifier</button>
                            <button onclick="supprimerCitoyen('${escapeHtml(citoyen.id)}')" style="background: #ef4444; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">🗑️ Supprimer</button>
                        </div>
                    </div>
                    <div class="admin-citizen-info" style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; font-size: 13px;">
                        <div><span style="color: #a0aec0;">Nom :</span> <strong>${escapeHtml(citoyen.nom)}</strong></div>
                        <div><span style="color: #a0aec0;">Post-nom :</span> <strong>${escapeHtml(citoyen.postnom)}</strong></div>
                        <div><span style="color: #a0aec0;">Prénom :</span> <strong>${escapeHtml(citoyen.prenom)}</strong></div>
                        <div><span style="color: #a0aec0;">Date naissance :</span> <strong>${escapeHtml(citoyen.dateNaissance)}</strong></div>
                        <div><span style="color: #a0aec0;">Lieu naissance :</span> <strong>${escapeHtml(citoyen.lieuNaissance)}</strong></div>
                        <div><span style="color: #a0aec0;">Père :</span> <strong>${escapeHtml(citoyen.nomPere)}</strong></div>
                        <div><span style="color: #a0aec0;">Mère :</span> <strong>${escapeHtml(citoyen.nomMere)}</strong></div>
                        <div><span style="color: #a0aec0;">Clan/Famille :</span> <strong style="color: #d4af37;">${escapeHtml(citoyen.nomFamille)}</strong></div>
                        <div><span style="color: #a0aec0;">Statut matrimonial :</span> <strong>${escapeHtml(statutLabel)}</strong></div>
                        <div><span style="color: #a0aec0;">Conjoint(e) :</span> <strong>${escapeHtml(citoyen.nomConjoint)}</strong></div>
                        <div style="grid-column: 1 / -1;"><span style="color: #a0aec0;">Enfants :</span> <strong>${escapeHtml(citoyen.nomsEnfants)}</strong></div>
                        <div style="grid-column: 1 / -1;"><span style="color: #a0aec0;">Biens :</span> <strong>${escapeHtml(citoyen.biens)}</strong></div>
                        <div><span style="color: #a0aec0;">Téléphone :</span> <strong>${escapeHtml(citoyen.telephone)}</strong></div>
                        <div><span style="color: #a0aec0;">Groupe sanguin :</span> <strong>${escapeHtml(citoyen.groupeSanguin)}</strong></div>
                        <div style="grid-column: 1 / -1; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.05); color: #a0aec0; font-size: 12px;">
                            📅 Enregistré le : ${escapeHtml(citoyen.dateEnregistrement)}
                        </article>
                    </div>
                </div>
            `;
        });

        htmlContenu += `</div>`;
    }

    htmlContenu += `</div>`;
    modale.innerHTML = htmlContenu;
    document.body.appendChild(modale);

    modale.querySelectorAll('[data-citizen-photo]').forEach(async image => {
        const citoyen = donneesActuelles.find(enregistrement => enregistrement.id === image.dataset.citizenPhoto);
        if (!citoyen?.photoPath) return;

        const photoUrl = await getCitizenPhotoUrl(citoyen.photoPath);
        if (photoUrl && modale.isConnected) image.src = photoUrl;
    });

    document.getElementById('close-admin').addEventListener('click', function() {
        modale.remove();
    });
}

// ==========================================
// 4. ACTION INTERACTIVE : CHARGER POUR MODIFIER
// ==========================================
window.chargerCitoyenPourModification = async function(id) {
    // 1. Trouver le citoyen dans notre base locale grâce à son ID
    const citoyen = baseDeDonnees.find(c => c.id === id);
    
    if (citoyen) {
        // 2. Remplir à nouveau les champs du formulaire avec ses données existantes
        document.getElementById('nom').value = citoyen.nom;
        document.getElementById('postnom').value = citoyen.postnom;
        document.getElementById('prenom').value = citoyen.prenom;
        document.getElementById('date-naissance').value = citoyen.dateNaissance;
        document.getElementById('lieu-naissance').value = citoyen.lieuNaissance;
        document.getElementById('nom-pere').value = citoyen.nomPere;
        document.getElementById('nom-mere').value = citoyen.nomMere;
        document.getElementById('nom-famille').value = citoyen.nomFamille;
        document.getElementById('statut-matrimonial').value = citoyen.statutMatrimonial;
        document.getElementById('nom-conjoint').value = citoyen.nomConjoint;
        document.getElementById('noms-enfants').value = citoyen.nomsEnfants;
        document.getElementById('biens').value = citoyen.biens;
        document.getElementById('telephone').value = citoyen.telephone;
        document.getElementById('groupe-sanguin').value = citoyen.groupeSanguin;
        photoInput.value = '';
        releasePhotoObjectUrl();
        const photoUrl = await getCitizenPhotoUrl(citoyen.photoPath);
        setPhotoPreview(photoUrl);
        setReceiptPhoto(photoUrl);

        // 3. Activer le mode modification en stockant l'ID en cours
        idEnCoursDeModification = id;

        // 4. Changer le design du bouton "Générer" pour avertir visuellement qu'on modifie
        btnGenerer.innerText = "Enregistrer les modifications";
        btnGenerer.style.background = "linear-gradient(45deg, #3b82f6, #1d4ed8)"; // Couleur bleue alerte

        // 5. Fermer automatiquement l'espace admin pour retourner sur le formulaire graphique
        const modalAdminEl = document.getElementById('modale-admin');
        if (modalAdminEl) modalAdminEl.remove();

        // 6. Mettre à jour l'aperçu du reçu avec les données chargées
        if (typeof recuId !== 'undefined') {
            recuId.innerText = citoyen.id || '--------';
            recuNomComplet.innerText = `${citoyen.nom} ${citoyen.postnom} ${citoyen.prenom}`;
            recuNaissance.innerText = (citoyen.dateNaissance ? new Date(citoyen.dateNaissance).toLocaleDateString('fr-FR') : '??/??/????') + ' à ' + (citoyen.lieuNaissance || '—');
            recuParents.innerText = `${citoyen.nomPere} & ${citoyen.nomMere}`;
            recuClan.innerText = citoyen.nomFamille || '—';
            recuConjoint.innerText = citoyen.statutMatrimonial === 'marie' ? (citoyen.nomConjoint || '—') : 'Célibataire / Non applicable';
            recuEnfants.innerText = citoyen.nomsEnfants || 'Aucun';
            recuBiens.innerText = citoyen.biens || 'Aucun bien déclaré';
            recuSang.innerText = citoyen.groupeSanguin || 'Inconnu';
        }

        showToast("✏️ Les informations ont été chargées dans le formulaire. Enregistrez pour appliquer les modifications.", 'info');
    }
};

// Fonction de suppression
window.supprimerCitoyen = async function(id) {
    if (confirm("🚨 Voulez-vous vraiment supprimer définitivement ce citoyen du registre ?")) {
        const citoyen = baseDeDonnees.find(enregistrement => enregistrement.id === id);
        try {
            if (isFileProtocol) {
                baseDeDonnees = baseDeDonnees.filter(c => c.id !== id);
                localStorage.setItem('village_citoyens', JSON.stringify(baseDeDonnees));
            } else {
                await requestCitizensApi('DELETE', { id });
                baseDeDonnees = baseDeDonnees.filter(c => c.id !== id);
            }
        } catch (error) {
            showToast(getErrorMessage(error, 'Impossible de supprimer ce citoyen.'), 'error');
            return;
        }
        await deleteCitizenPhoto(citoyen?.photoPath);
        alert("Citoyen supprimé.");
        ouvrirEspaceAdmin(); 
    }
};