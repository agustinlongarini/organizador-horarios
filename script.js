// Importa los módulos necesarios de Firebase para autenticación y Firestore
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

// Configuración de Firebase para conectar con el proyecto específico
const firebaseConfig = {
    apiKey: "AIzaSyDPKk9JWrBWg3nimQAKi0xXDKJNsnIjIrk",
    authDomain: "organizador-horarios-bd972.firebaseapp.com",
    projectId: "organizador-horarios-bd972",
    storageBucket: "organizador-horarios-bd972.firebasestorage.app",
    messagingSenderId: "551546236622",
    appId: "1:551546236622:web:9b19289d4b60d5f2932a9f"
};

// Inicializa la app de Firebase y los servicios de autenticación y base de datos
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = firebaseConfig.projectId;

// Variables globales para el manejo de materias y usuario
let courses = [];
let currentUserId = null;
let unsubscribeFromCourses = null;
const courseColorMap = new Map(); // Mapa para asignar colores únicos a cada materia

// Referencias a elementos del DOM
const courseForm = document.getElementById('course-form');
const courseList = document.getElementById('course-list');
const statusMessage = document.getElementById('status-message');
const scheduleContainer = document.getElementById('schedule-container');
const scheduleEventsContainer = document.getElementById('schedule-events');
const userIdDisplay = document.getElementById('userIdDisplay');
const exportBtn = document.getElementById('export-btn');
const exportLoader = document.getElementById('export-loader');
const scheduleExportArea = document.getElementById('schedule-export-area');

// Constantes para la visualización del horario
const HOUR_ROW_HEIGHT_REM = 4;
const SCHEDULE_START_HOUR = 7;
const SCHEDULE_END_HOUR = 24;
const DAY_NAMES = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const TIME_COLUMN_WIDTH_PX = 60;

// Paleta de colores predefinida para distinguir materias
const PREDEFINED_COLORS = [
    { bg: 'hsl(25, 85%, 88%)', text: 'hsl(25, 50%, 40%)' }, { bg: 'hsl(55, 80%, 88%)', text: 'hsl(55, 50%, 40%)' },
    { bg: 'hsl(90, 70%, 88%)', text: 'hsl(90, 50%, 40%)' }, { bg: 'hsl(160, 70%, 88%)', text: 'hsl(160, 50%, 40%)' },
    { bg: 'hsl(200, 85%, 90%)', text: 'hsl(200, 50%, 40%)' }, { bg: 'hsl(260, 75%, 90%)', text: 'hsl(260, 50%, 40%)' },
    { bg: 'hsl(310, 70%, 90%)', text: 'hsl(310, 50%, 40%)' }, { bg: 'hsl(0, 75%, 90%)', text: 'hsl(0, 50%, 40%)' },
    { bg: 'hsl(180, 50%, 85%)', text: 'hsl(180, 50%, 35%)' }, { bg: 'hsl(30, 70%, 85%)', text: 'hsl(30, 50%, 35%)' },
    { bg: 'hsl(230, 60%, 90%)', text: 'hsl(230, 50%, 45%)' }, { bg: 'hsl(120, 40%, 88%)', text: 'hsl(120, 30%, 38%)' },
];

// Convierte una hora en formato "HH:mm" a minutos totales
const timeToMinutes = (timeStr) => {
    if (!timeStr) return 0;
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
};

// Asigna colores únicos a cada materia según su nombre
function assignColorsToCourses() {
    const uniqueCourseNames = [...new Set(courses.map(c => c.name))];
    courseColorMap.clear();
    uniqueCourseNames.forEach((name, index) => {
        const colorIndex = index % PREDEFINED_COLORS.length;
        courseColorMap.set(name, PREDEFINED_COLORS[colorIndex]);
    });
}

// Devuelve el color asignado a una materia, o un color por defecto si no existe
function getCourseColor(courseName) {
    return courseColorMap.get(courseName) || { bg: '#E5E7EB', text: '#374151' }; 
}

// Habilita o deshabilita el formulario de materias
function setFormEnabled(isEnabled) {
    const formElements = courseForm.elements;
    for (let i = 0; i < formElements.length; i++) {
        formElements[i].disabled = !isEnabled;
    }
}

// Renderiza la lista de materias agregadas
function renderCourseList() {
    courseList.innerHTML = '';
    if (courses.length === 0) {
        courseList.innerHTML = '<p class="text-gray-500">Aún no has agregado materias.</p>';
        return;
    }
    courses.forEach(course => {
        const color = getCourseColor(course.name);
        const courseEl = document.createElement('div');
        courseEl.className = 'flex justify-between items-center p-3 rounded-lg transition';
        courseEl.style.backgroundColor = color.bg;
        courseEl.style.color = color.text;
        const conflict = checkIndividualConflict(course);
        if (conflict) {
            courseEl.classList.add('ring-4', 'ring-red-500', 'ring-offset-2');
        }
        courseEl.innerHTML = `
            <div>
                <p class="font-bold">${course.name}</p>
                <p class="text-sm">Comisión: ${course.commission} | ${course.dayName}: ${course.startTime} - ${course.endTime}</p>
            </div>
            <button data-id="${course.id}" class="delete-btn bg-red-500 text-white w-8 h-8 rounded-full hover:bg-red-600 flex items-center justify-center transition-transform transform hover:scale-110">&times;</button>
        `;
        courseList.appendChild(courseEl);
    });
}

// Dibuja la grilla del horario (líneas y cabeceras de días/horas)
function renderScheduleGrid(container, startHour = SCHEDULE_START_HOUR, endHour = SCHEDULE_END_HOUR) {
    const gridLines = container.querySelectorAll('.grid-row, .grid-header');
    gridLines.forEach(line => line.remove());
    
    const headerContainer = document.createElement('div');
    headerContainer.className = 'grid-header col-span-8 grid grid-cols-[60px_repeat(7,1fr)] sticky top-0 bg-white z-10';
    headerContainer.innerHTML = '<div></div>' + DAY_NAMES.slice(1).map(name => `<div class="text-center font-bold p-2 border-b-2 border-gray-200">${name}</div>`).join('');
    container.prepend(headerContainer);

    const totalHours = endHour - startHour;
    container.style.gridTemplateRows = `auto repeat(${totalHours + 1}, ${HOUR_ROW_HEIGHT_REM}rem)`;

    for (let hour = startHour; hour <= endHour; hour++) {
        const row = document.createElement('div');
        row.className = 'grid-row col-span-8 grid grid-cols-[60px_repeat(7,1fr)]';
        row.style.gridRow = `${hour - startHour + 2}`;
        
        const timeLabel = document.createElement('div');
        timeLabel.className = 'text-right text-xs text-gray-500 pr-2 -mt-2';
        timeLabel.textContent = `${hour}:00`;
        row.appendChild(timeLabel);

        for (let day = 1; day <= 7; day++) {
            const cell = document.createElement('div');
            cell.className = 'border-t border-r border-gray-200 h-full';
            if (day === 1) cell.classList.add('border-l');
            row.appendChild(cell);
        }
        container.appendChild(row);
    }
}

// Dibuja los bloques de materias sobre la grilla del horario
function renderScheduleEvents(container, startHour = SCHEDULE_START_HOUR, forcedParentWidth = null) {
    container.innerHTML = '';
    const scheduleStartTimeInMinutes = startHour * 60;
    const gridWidth = forcedParentWidth !== null ? forcedParentWidth : container.parentElement.offsetWidth;
    const dayColumnsWidth = gridWidth - TIME_COLUMN_WIDTH_PX;

    courses.forEach(course => {
        const startMinutes = timeToMinutes(course.startTime);
        const endMinutes = timeToMinutes(course.endTime);
        if (endMinutes <= startMinutes) return;

        const top = ((startMinutes - scheduleStartTimeInMinutes) / 60) * HOUR_ROW_HEIGHT_REM;
        const height = ((endMinutes - startMinutes) / 60) * HOUR_ROW_HEIGHT_REM;
        const color = getCourseColor(course.name);

        const eventEl = document.createElement('div');
        eventEl.className = 'event-block';
        eventEl.style.backgroundColor = color.bg;
        eventEl.style.color = color.text;
        eventEl.style.border = `1px solid ${color.text}`;
        eventEl.style.top = `${top}rem`;
        eventEl.style.height = `${height}rem`;
        
        eventEl.style.left = `${TIME_COLUMN_WIDTH_PX + ((parseInt(course.day) - 1) * (dayColumnsWidth / 7))}px`;
        eventEl.style.width = `${(dayColumnsWidth / 7) - 4}px`;

        eventEl.innerHTML = `
            <p class="event-name">${course.name}</p>
            <p class="event-details">${course.commission}</p>
            <p class="event-details">${course.startTime} - ${course.endTime}</p>
        `;
        container.appendChild(eventEl);
    });
}

// --- Funciones de lógica de conflicto y actualización de UI ---

// Verifica si hay algún conflicto de horario entre todas las materias
function checkAllConflicts() {
    let conflictFound = false;
    for (let i = 0; i < courses.length; i++) {
        for (let j = i + 1; j < courses.length; j++) {
            const c1 = courses[i];
            const c2 = courses[j];
            if (c1.day === c2.day) {
                const start1 = timeToMinutes(c1.startTime);
                const end1 = timeToMinutes(c1.endTime);
                const start2 = timeToMinutes(c2.startTime);
                const end2 = timeToMinutes(c2.endTime);
                if (start1 < end2 && end1 > start2) {
                    conflictFound = true; break;
                }
            }
        }
        if (conflictFound) break;
    }
    if (conflictFound) {
        statusMessage.textContent = 'Conflicto de horario detectado';
        statusMessage.className = 'p-4 rounded-lg text-center font-semibold bg-red-100 text-red-800';
    } else if (courses.length > 0) {
        statusMessage.textContent = 'Horarios compatibles';
        statusMessage.className = 'p-4 rounded-lg text-center font-semibold bg-green-100 text-green-800';
    } else if (currentUserId) {
        statusMessage.textContent = 'Conectado. Listo para organizar';
        statusMessage.className = 'p-4 rounded-lg text-center font-semibold bg-blue-100 text-blue-800';
    }
}

// Verifica si una materia específica tiene conflicto con otra
function checkIndividualConflict(courseToCheck) {
    for(const course of courses) {
        if (course.id === courseToCheck.id) continue;
        if (course.day === courseToCheck.day) {
            const start1 = timeToMinutes(course.startTime);
            const end1 = timeToMinutes(course.endTime);
            const start2 = timeToMinutes(courseToCheck.startTime);
            const end2 = timeToMinutes(courseToCheck.endTime);
            if (start1 < end2 && end1 > start2) return true;
        }
    }
    return false;
}

// Actualiza toda la interfaz de usuario (colores, conflictos, lista y grilla)
function updateUI() {
    assignColorsToCourses();
    checkAllConflicts();
    renderCourseList();
    renderScheduleGrid(scheduleContainer, SCHEDULE_START_HOUR, SCHEDULE_END_HOUR);
    scheduleEventsContainer.style.top = `${HOUR_ROW_HEIGHT_REM}rem`;
    renderScheduleEvents(scheduleEventsContainer, SCHEDULE_START_HOUR);
}

// Exporta el horario como imagen PNG usando html2canvas
async function handleExport() {
    if (courses.length === 0) {
        alert("No hay materias para exportar.");
        return;
    }
    exportLoader.style.display = 'flex';

    let minMinutes = 24 * 60;
    let maxMinutes = 0;
    courses.forEach(c => {
        minMinutes = Math.min(minMinutes, timeToMinutes(c.startTime));
        maxMinutes = Math.max(maxMinutes, timeToMinutes(c.endTime));
    });

    const minHour = Math.max(0, Math.floor(minMinutes / 60) - 1);
    const maxHour = Math.min(24, Math.ceil(maxMinutes / 60));
    const exportContainer = scheduleExportArea.cloneNode(true);
    exportContainer.id = 'temp-export-container';
    const exportWidth = 800; 
    
    Object.assign(exportContainer.style, {
        position: 'absolute',
        left: '-9999px',
        top: '0px',
        width: `${exportWidth}px`,
    });
    document.body.appendChild(exportContainer);

    const exportGrid = exportContainer.querySelector('#schedule-container');
    const exportEvents = exportContainer.querySelector('#schedule-events');
    
    if (!exportGrid || !exportEvents) {
        console.error("Could not find schedule elements in cloned container.");
        exportLoader.style.display = 'none';
        document.body.removeChild(exportContainer);
        return;
    }
    
    renderScheduleGrid(exportGrid, minHour, maxHour);
    exportEvents.style.top = `${HOUR_ROW_HEIGHT_REM}rem`;
    renderScheduleEvents(exportEvents, minHour, exportWidth);

    await new Promise(resolve => setTimeout(resolve, 100));

    html2canvas(exportContainer, {
        scale: 2.5,
        logging: false,
        useCORS: true,
        width: exportWidth, 
        windowWidth: exportWidth,
    }).then(canvas => {
        const link = document.createElement('a');
        link.download = 'horario.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    }).finally(() => {
        exportLoader.style.display = 'none';
        document.body.removeChild(exportContainer);
    });
}

// Maneja el evento de agregar una nueva materia al horario
async function handleAddCourse(e) {
    e.preventDefault();
    if (!currentUserId) {
        alert("Error de conexión. Por favor, recarga la página.");
        return;
    }
    const name = document.getElementById('materia-nombre').value.trim();
    const commission = document.getElementById('materia-comision').value.trim();
    const daySelect = document.getElementById('materia-dia');
    const day = daySelect.value;
    const dayName = daySelect.options[daySelect.selectedIndex].text;
    const startTime = document.getElementById('materia-inicio').value;
    const endTime = document.getElementById('materia-fin').value;
    if (!name || !commission || !day || !startTime || !endTime) return;
    if (timeToMinutes(startTime) >= timeToMinutes(endTime)) {
        alert("La hora de fin debe ser posterior a la hora de inicio.");
        return;
    }
    try {
        await addDoc(collection(db, `artifacts/${appId}/users/${currentUserId}/courses`), { name, commission, day, dayName, startTime, endTime });
        courseForm.reset();
        setFormEnabled(true);
    } catch (error) {
        console.error("Error adding document: ", error);
        alert("Hubo un error al guardar la materia.");
    }
}

// Maneja el evento de eliminar una materia del horario
async function handleDeleteCourse(e) {
    if (!e.target.classList.contains('delete-btn') || !currentUserId) return;
    const courseId = e.target.dataset.id;
    if (confirm('¿Estás seguro de que quieres eliminar esta materia?')) {
        try {
            await deleteDoc(doc(db, `artifacts/${appId}/users/${currentUserId}/courses`, courseId));
        } catch (error) {
            console.error("Error deleting document: ", error);
            alert("Hubo un error al eliminar la materia.");
        }
    }
}

// Configura el listener de Firebase para actualizar en tiempo real las materias del usuario
function setupFirebaseListener(userId) {
    if (unsubscribeFromCourses) {
        unsubscribeFromCourses();
    }
    const coursesCollection = collection(db, `artifacts/${appId}/users/${userId}/courses`);
    unsubscribeFromCourses = onSnapshot(coursesCollection, (snapshot) => {
        courses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateUI();
    }, (error) => console.error("Error al escuchar cambios:", error));
}

// Inicializa la autenticación y la app, y configura el estado inicial de la UI
async function initializeAppAndAuth() {
    setFormEnabled(false);
    try {
        await setPersistence(auth, browserLocalPersistence);

        onAuthStateChanged(auth, (user) => {
            if (user) {
                currentUserId = user.uid;
                userIdDisplay.textContent = `ID de Sesión: ${user.uid}`;
                setFormEnabled(true);
                statusMessage.textContent = 'Conectado. ¡Listo para organizar!';
                statusMessage.className = 'p-4 rounded-lg text-center font-semibold bg-blue-100 text-blue-800';
                setupFirebaseListener(user.uid);
            } else {
                signInAnonymously(auth).catch((error) => {
                    console.error("Anonymous sign-in failed:", error);
                    statusMessage.textContent = "Error de autenticación. No se podrán guardar los datos.";
                    statusMessage.className = 'p-4 rounded-lg text-center font-semibold bg-red-100 text-red-800';
                    setFormEnabled(false);
                });
            }
        });
    } catch (error) {
        console.error("Setting persistence failed:", error);
        statusMessage.textContent = "Error de autenticación. No se podrán guardar los datos.";
        statusMessage.className = 'p-4 rounded-lg text-center font-semibold bg-red-100 text-red-800';
    }
}

// Evento principal: inicializa la app y configura los listeners de UI
window.addEventListener('DOMContentLoaded', () => {
    initializeAppAndAuth();
    courseForm.addEventListener('submit', handleAddCourse);
    courseList.addEventListener('click', handleDeleteCourse);
    exportBtn.addEventListener('click', handleExport);
    window.addEventListener('resize', updateUI);
});