// استيراد Firebase SDK
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.6.10/firebase-app.js'
import { getDatabase, ref, push, onChildAdded, serverTimestamp, limitToLast, query, orderByChild } from 'https://www.gstatic.com/firebasejs/9.6.10/firebase-database.js'

// ⚠️ استبدل هذه البيانات ببيانات مشروعك من Firebase Console ⚠️
const firebaseConfig = {
  apiKey: "AIzaSyB1AsEHXP05nQ8M66jYPusheLaE60q_JwU",
  authDomain: "mychat-2d881.firebaseapp.com",
  databaseURL: "https://mychat-2d881-default-rtdb.firebaseio.com",
  projectId: "mychat-2d881",
  storageBucket: "mychat-2d881.firebasestorage.app",
  messagingSenderId: "532385733649",
  appId: "1:532385733649:web:7bb6cce9add057acf1e5b0",
  measurementId: "G-2702K5S2V1"
};


// تهيئة Firebase
const app = initializeApp(firebaseConfig)
const database = getDatabase(app)

// استعلام للحصول على آخر 20 رسالة فقط
const messagesRef = ref(database, 'messages')
const recentMessagesQuery = query(messagesRef, orderByChild('timestamp'), limitToLast(20))

const messageContainer = document.getElementById('message-container')
const messageForm = document.getElementById('send-container')
const messageInput = document.getElementById('message-input')

let userName = ''
let messageCount = 0
const MAX_MESSAGES = 20

// طلب اسم المستخدم
function getUserName() {
    userName = prompt('ما هو اسمك؟') || `مستخدم${Math.floor(Math.random() * 1000)}`
    
    // إرسال رسالة انضمام للجميع
    push(messagesRef, {
        type: 'system',
        message: `${userName} انضم للدردشة`,
        timestamp: serverTimestamp()
    })
}

// استماع للرسائل الجديدة فقط
onChildAdded(recentMessagesQuery, (snapshot) => {
    const data = snapshot.val()
    
    // تجاهل الرسائل القديمة قبل انضمام المستخدم
    if (!userName) return
    
    if (data.type === 'system') {
        appendMessage(data.message, 'system')
    } else if (data.userName === userName) {
        // تجاهل رسائلي الخاصة (تم عرضها مسبقاً)
        return
    } else if (data.type === 'message') {
        appendMessage(data.message, 'other', data.userName)
    }
    
    // التحكم في عدد الرسائل
    manageMessageLimit()
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
    
    // التحكم في عدد الرسائل
    manageMessageLimit()
})

// دالة إضافة الرسالة للشاشة - الاسم بجانب الرسالة
function appendMessage(message, type, userName = '') {
    const messageElement = document.createElement('div')
    messageElement.className = `message`
    
    const time = new Date().toLocaleTimeString('ar-EG', { 
        hour: '2-digit', 
        minute: '2-digit' 
    })
    
    if (type === 'self' || type === 'other') {
        messageElement.innerHTML = `
            <span class="user-name">${userName}:</span>
            <span class="message-text">${message}</span>
            <span class="message-time">${time}</span>
        `
    } else {
        messageElement.innerHTML = `
            <span class="message-text">${message}</span>
            <span class="message-time">${time}</span>
        `
    }
    
    messageContainer.append(messageElement)
    messageContainer.scrollTop = messageContainer.scrollHeight
    messageCount++
}

// التحكم في عدد الرسائل (الحد الأقصى 20)
function manageMessageLimit() {
    if (messageCount > MAX_MESSAGES) {
        // حذف أقدم رسالة
        const messages = messageContainer.querySelectorAll('.message')
        if (messages.length > MAX_MESSAGES) {
            messages[0].remove()
            messageCount--
        }
    }
}

// بدء التطبيق
getUserName()
