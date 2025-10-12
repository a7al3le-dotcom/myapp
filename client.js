// استيراد Firebase SDK
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.6.10/firebase-app.js'
import { getDatabase, ref, push, onChildAdded, serverTimestamp } from 'https://www.gstatic.com/firebasejs/9.6.10/firebase-database.js'

// ⚠️ استبدل هذه البيانات ببيانات مشروعك من Firebase Console ⚠️
const firebaseConfig = {
    apiKey: "AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    authDomain: "your-project-id.firebaseapp.com",
    databaseURL: "https://your-project-id-default-rtdb.firebaseio.com",
    projectId: "your-project-id",
    storageBucket: "your-project-id.appspot.com",
    messagingSenderId: "123456789000",
    appId: "1:123456789000:web:aaaaaaaaaaaaaaaaaaaaaa"
};

// تهيئة Firebase
const app = initializeApp(firebaseConfig)
const database = getDatabase(app)
const messagesRef = ref(database, 'messages')

const messageContainer = document.getElementById('message-container')
const messageForm = document.getElementById('send-container')
const messageInput = document.getElementById('message-input')

let userName = ''

// طلب اسم المستخدم
function getUserName() {
    userName = prompt('ما هو اسمك؟') || 'مستخدم مجهول'
    appendMessage('لقد انضممت للدردشة', 'system')
    
    // إرسال رسالة انضمام للجميع
    push(messagesRef, {
        type: 'system',
        message: `${userName} انضم للدردشة`,
        timestamp: serverTimestamp()
    })
}

// استماع للرسائل الجديدة
onChildAdded(messagesRef, (snapshot) => {
    const data = snapshot.val()
    
    // تجاهل الرسائل القديمة قبل انضمام المستخدم
    if (!userName) return
    
    if (data.type === 'system') {
        // عرض رسائل النظام للجميع
        appendMessage(data.message, 'system')
    } else if (data.userName === userName) {
        // تجاهل رسائلي الخاصة (تم عرضها مسبقاً)
        return
    } else {
        // عرض رسائل الآخرين
        appendMessage(data.message, 'other', data.userName)
    }
})

// إرسال رسالة جديدة
messageForm.addEventListener('submit', e => {
    e.preventDefault()
    const message = messageInput.value.trim()
    
    if (message === '') return
    
    // عرض الرسالة فوراً
    appendMessage(message, 'self', userName)
    
    // إرسال الرسالة لـ Firebase
    push(messagesRef, {
        message: message,
        userName: userName,
        type: 'message',
        timestamp: serverTimestamp()
    })
    
    messageInput.value = ''
})

// دالة إضافة الرسالة للشاشة
function appendMessage(message, type, userName = '') {
    const messageElement = document.createElement('div')
    messageElement.className = `message ${type}`
    
    if (type === 'self' || type === 'other') {
        messageElement.innerHTML = `<span class="user-name">${userName}:</span> ${message}`
    } else {
        messageElement.textContent = message
    }
    
    messageContainer.append(messageElement)
    messageContainer.scrollTop = messageContainer.scrollHeight
}

// بدء التطبيق
getUserName()
