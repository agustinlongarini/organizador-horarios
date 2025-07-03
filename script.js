import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

/* Configuración de Firebase*/
const firebaseConfig = {
    apiKey: "AIzaSyDPKk9JWrBWg3nimQAKi0xXDKJNsnIjIrk",
    authDomain: "organizador-horarios-bd972.firebaseapp.com",
    projectId: "organizador-horarios-bd972",
    storageBucket: "organizador-horarios-bd972.firebasestorage.app",
    messagingSenderId: "551546236622",
    appId: "1:551546236622:web:9b19289d4b60d5f2932a9f"
};

/* Inicialización de Firebase y referencias principales */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = firebaseConfig.projectId;

let courses = [];
let currentUserId = null;
let unsubscribeFromCourses = null;
const courseForm = document.getElementById('course-form');
const courseList = document.getElementById('course-list');
const statusMessage = document.getElementById('status-message');
const scheduleContainer = document.getElementById('schedule-container');
const scheduleEventsContainer = document.getElementById('schedule-events');
const userIdDisplay = document.getElementById('userIdDisplay');
const exportBtn = document.getElementById('export-btn');
const exportLoader = document.getElementById('export-loader');
const scheduleExportArea = document.getElementById('schedule-export-area');

/* Constantes de configuración visual y lógica */
const HOUR_ROW_HEIGHT_REM = 4;
const SCHEDULE_START_HOUR = 7;
const SCHEDULE_END_HOUR = 24;
const DAY_NAMES = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const TIME_COLUMN_WIDTH_PX = 60;
const PREDEFINED_COLORS = [
    { bg: 'hsl(25, 85%, 88%)', text: 'hsl(25, 50%, 40%)' }, { bg: 'hsl(55, 80%, 88%)', text: 'hsl(55, 50%, 40%)' },
    { bg: 'hsl(90, 70%, 88%)', text: 'hsl(90, 50%, 40%)' }, { bg: 'hsl(160, 70%, 88%)', text: 'hsl(160, 50%, 40%)' },
    { bg: 'hsl(200, 85%, 90%)', text: 'hsl(200, 50%, 40%)' }, { bg: 'hsl(260, 75%, 90%)', text: 'hsl(260, 50%, 40%)' },
    { bg: 'hsl(310, 70%, 90%)', text: 'hsl(310, 50%, 40%)' }, { bg: 'hsl(0, 75%, 90%)', text: 'hsl(0, 50%, 40%)' },
    { bg: 'hsl(180, 50%, 85%)', text: 'hsl(180, 50%, 35%)' }, { bg: 'hsl(30, 70%, 85%)', text: 'hsl(30, 50%, 35%)' },
    { bg: 'hsl(230, 60%, 90%)', text: 'hsl(230, 50%, 45%)' }, { bg: 'hsl(120, 40%, 88%)', text: 'hsl(120, 30%, 38%)' },
];

/* Utilidades para manejo de horarios y colores */
const timeToMinutes = (timeStr) => {
    if (!timeStr) return 0;
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
};

function getCourseColor(courseName) {
    let hash = 0;
    for (let i = 0; i < courseName.length; i++) {
        hash = courseName.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash;
    }
    const index = Math.abs(hash) % PREDEFINED_COLORS.length;
    return PREDEFINED_COLORS[index];
}

function setFormEnabled(isEnabled) {
    const formElements = courseForm.elements;
    for (let i = 0; i < formElements.length; i++) {
        formElements[i].disabled = !isEnabled;
    }
}

/* Renderiza la lista de materias cargadas */
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

/* Renderiza la grilla de fondo del horario semanal */
function renderScheduleGrid(container, startHour = SCHEDULE_START_HOUR, endHour = SCHEDULE_END_HOUR) {
    const gridLines = container.querySelectorAll('.grid-row');
    gridLines.forEach(line => line.remove());
    
    if (!container.querySelector('.grid-header')) {
        const headerContainer = document.createElement('div');
        headerContainer.className = 'grid-header col-span-8 grid grid-cols-[60px_repeat(7,1fr)] sticky top-0 bg-white z-10';
        headerContainer.innerHTML = '<div></div>' + DAY_NAMES.slice(1).map(name => `<div class="text-center font-bold p-2 border-b-2 border-gray-200">${name}</div>`).join('');
        container.prepend(headerContainer);
    }

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

/* Renderiza los bloques de materias sobre la grilla */
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

/* Verifica si hay conflictos de horario entre materias */
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

/* Verifica si una materia específica tiene conflicto con otra */
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

/* Actualiza toda la interfaz visual */
function updateUI() {
    checkAllConflicts();
    renderCourseList();
    renderScheduleGrid(scheduleContainer, SCHEDULE_START_HOUR, SCHEDULE_END_HOUR);
    scheduleEventsContainer.style.top = `${HOUR_ROW_HEIGHT_REM}rem`;
    renderScheduleEvents(scheduleEventsContainer, SCHEDULE_START_HOUR);
}

/* Exporta el horario como imagen PNG */
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
    Object.assign(exportContainer.style, {
        position: 'absolute',
        left: '-9999px',
        top: '0px',
        width: `${scheduleExportArea.offsetWidth}px`,
    });
    document.body.appendChild(exportContainer);

    const exportGrid = exportContainer.querySelector('#schedule-container');
    const exportEvents = exportContainer.querySelector('#schedule-events');
    
    if (!exportGrid || !exportEvents) {
        console.error("No se encontraron los elementos del horario en el contenedor clonado.");
        exportLoader.style.display = 'none';
        document.body.removeChild(exportContainer);
        return;
    }
    
    renderScheduleGrid(exportGrid, minHour, maxHour);
    exportEvents.style.top = `${HOUR_ROW_HEIGHT_REM}rem`;
    renderScheduleEvents(exportEvents, minHour, scheduleExportArea.offsetWidth);

    await new Promise(resolve => setTimeout(resolve, 100));

    html2canvas(exportContainer, {
        scale: 2.5,
        logging: false,
        useCORS: true,
        windowWidth: exportContainer.scrollWidth,
        windowHeight: exportContainer.scrollHeight
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

/* Maneja el evento de agregar una materia */
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
        console.error("Error al guardar la materia: ", error);
        alert("Hubo un error al guardar la materia.");
    }
}

/* Maneja el evento de eliminar una materia */
async function handleDeleteCourse(e) {
    if (!e.target.classList.contains('delete-btn') || !currentUserId) return;
    const courseId = e.target.dataset.id;
    if (confirm('¿Estás seguro de que quieres eliminar esta materia?')) {
        try {
            await deleteDoc(doc(db, `artifacts/${appId}/users/${currentUserId}/courses`, courseId));
        } catch (error) {
            console.error("Error al eliminar la materia: ", error);
            alert("Hubo un error al eliminar la materia.");
        }
    }
}

/* Escucha los cambios en la base de datos de materias en tiempo real */
function setupFirebaseListener(userId) {
    const coursesCollection = collection(db, `artifacts/${appId}/users/${userId}/courses`);
    if (unsubscribeFromCourses) unsubscribeFromCourses();
    unsubscribeFromCourses = onSnapshot(coursesCollection, (snapshot) => {
        courses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateUI();
    }, (error) => console.error("Error escuchando cambios en materias:", error));
}

/* Inicialización de la aplicación y autenticación anónima */
window.addEventListener('DOMContentLoaded', () => {
    setFormEnabled(false);

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUserId = user.uid;
            userIdDisplay.textContent = `ID de Sesión: ${currentUserId}`;
            setFormEnabled(true);
            statusMessage.textContent = 'Conectado. ¡Listo para organizar!';
            statusMessage.className = 'p-4 rounded-lg text-center font-semibold bg-blue-100 text-blue-800';
            setupFirebaseListener(currentUserId);
        } else {
            try {
                await signInAnonymously(auth);
            } catch (error) {
                console.error("Error en autenticación anónima:", error);
                statusMessage.textContent = "Error de autenticación. No se podrán guardar los datos.";
                statusMessage.className = 'p-4 rounded-lg text-center font-semibold bg-red-100 text-red-800';
                setFormEnabled(false);
            }
        }
    });

    courseForm.addEventListener('submit', handleAddCourse);
    courseList.addEventListener('click', handleDeleteCourse);
    exportBtn.addEventListener('click', handleExport);
    window.addEventListener('resize', updateUI);
});