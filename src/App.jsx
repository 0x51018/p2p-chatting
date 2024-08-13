import React, { useState, useEffect, useRef } from 'react';
import Peer from 'peerjs';
import './App.css';

const App = () => (
  <div className="app">
    <h2>P2P 웹 서비스 프로토타입</h2>
    <MainPage />
  </div>
);

const MainPage = () => {
  const [page, setPage] = useState('main');
  const [roomId, setRoomId] = useState('');
  const [nickname, setNickname] = useState('');
  const [peerId, setPeerId] = useState(null);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [nicknameError, setNicknameError] = useState('');
  const [roomIdError, setRoomIdError] = useState('');
  const [validationState, setValidationState] = useState(''); // "" | "nickname" | "room"

  useEffect(() => {
    if (validationState === 'nickname' || validationState === 'room') {
      updateNicknameValid();
    }
    if (validationState === 'room') {
      updateRoomIDValid();
    }
  }, [nickname, roomId, validationState]);

  const handleCreateRoom = () => {
    setValidationState('nickname');
    if (updateNicknameValid()) {
      setIsCreatingRoom(true);
      setPage('room');
    }
  };

  const handleJoinRoom = () => {
    setValidationState('room');
    if (updateNicknameValid() && updateRoomIDValid()) {
      setIsCreatingRoom(false);
      setPage('room');
    }
  };

  const checkNickname = () => {
    if (nickname.length < 2 || nickname.length > 20) return "Nickname must be between 2 and 20 characters.";
    const validPattern = /^[가-힣a-zA-Z0-9_-]+$/;
    if (!validPattern.test(nickname)) return "Nickname can only contain Korean characters, letters, numbers, underscores, and hyphens.";
    if (nickname.startsWith(' ') || nickname.endsWith(' ')) return "Nickname cannot start or end with a space.";
    if (/^[\-_]/.test(nickname) || /[\-_]$/.test(nickname)) return "Nickname cannot start or end with an underscore or hyphen.";
    if (/[\-_]{2,}/.test(nickname)) return "Nickname cannot contain consecutive underscores or hyphens.";
    return "valid";
  };

  const updateNicknameValid = () => {
    const result = checkNickname();
    if (result === "valid") {
      setNicknameError('');
      return true;
    } else {
      setNicknameError(result);
      return false;
    }
  };

  const updateRoomIDValid = () => {
    if (roomId.length !== 5) {
      setRoomIdError('Room code must be 5 characters.');
      return false;
    } else {
      setRoomIdError('');
      return true;
    }
  };

  return (
    <div className="main-page">
      {page === 'main' ? (
        <div className="main-options">
          <input
            type="text"
            placeholder="Enter Nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
          <span className="error">{nicknameError}</span>
          <button onClick={handleCreateRoom} disabled={!nickname}>Create Room</button>
          <input
            type="text"
            placeholder="Enter Room Code"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          />
          <span className="error">{roomIdError}</span>
          <button onClick={handleJoinRoom} disabled={!roomId || !nickname}>Join Room</button>
        </div>
      ) : (
        <ChatRoom roomId={roomId} peerId={peerId} setPeerId={setPeerId} nickname={nickname} isCreatingRoom={isCreatingRoom} />
      )}
    </div>
  );
};



const ChatRoom = ({ roomId, peerId, setPeerId, nickname, isCreatingRoom }) => {
  const [peer, setPeer] = useState(null);
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [ready, setReady] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [currentRoomId, setCurrentRoomId] = useState('');
  const messageRef = useRef();
  const connections = useRef([]);
  const isHost = useRef(false);
  const idPrefix = "user-";

  useEffect(() => {
    const newPeer = new Peer(idPrefix + createRandomId());
    setPeer(newPeer);

    newPeer.on('open', id => {
      setPeerId(id);
      if (isCreatingRoom) {
        setCurrentRoomId(id.slice(idPrefix.length));
        isHost.current = true;
        setUsers([{ id, name: nickname, ready: false }]);
      } else {
        setCurrentRoomId(roomId);
        const conn = newPeer.connect(idPrefix + roomId);
        conn.on('open', () => {
          connections.current.push(conn);
          conn.on('data', data => handleData(data, conn));
          conn.send({ type: 'user', user: { id, name: nickname, ready: false } });
        });
      }
    });

    newPeer.on('connection', connection => {
      connection.on('data', data => handleData(data, connection));

      connection.peerConnection.oniceconnectionstatechange = () => {
        const state = connection.peerConnection.iceConnectionState;
        if (state === 'disconnected' || state === 'failed') {
          connections.current = connections.current.filter(conn => conn.peer !== connection.peer);
          setUsers(prevUsers => prevUsers.filter(user => user.id !== connection.peer));
        }
      };

      connection.on('open', () => {
        connections.current.push(connection);
        connection.send({ type: 'user', user: { id: connection.peer, name: nickname, ready: false } });
      });
    });

    return () => newPeer.destroy();
  }, [roomId, isCreatingRoom, nickname, setPeerId]);

  useEffect(() => {
    if (isHost.current) broadcastUserList();
  }, [users]);

  const handleData = (data, connection) => {
    switch (data.type) {
      case 'message':
        setMessages(prevMessages => [...prevMessages, { from: data.from, text: data.text }]);
        if (isHost.current) broadcastMessage(data, connection.peer);
        break;
      case 'user':
        setUsers(prevUsers => {
          if (!prevUsers.some(user => user.id === data.user.id)) return [...prevUsers, data.user];
          return prevUsers;
        });
        if (isHost.current) broadcastUserList();
        break;
      case 'user-list':
        setUsers(data.users);
        break;
      case 'ready':
        setUsers(prevUsers => prevUsers.map(user => user.id === data.id ? { ...user, ready: true } : user));
        if (isHost.current) broadcastUserList();
        break;
      case 'start':
        setGameStarted(true);
        break;
      default:
        console.warn(`Unknown data type: ${data.type}`);
        break;
    }
  };

  const createRandomId = () => {
    return Math.random().toString(36).slice(2, 7).toUpperCase();
  }

  const broadcastMessage = (data, excludePeerId = null) => {
    connections.current.forEach(connection => {
      if (connection.peer !== excludePeerId) connection.send(data);
    });
  };

  const sendMessage = () => {
    const message = messageRef.current.value;
    if (message) {
      const data = { type: 'message', from: peerId, text: message };
      setMessages([...messages, { from: peerId, text: message }]);
      if (isHost.current) broadcastMessage(data);
      else connections.current.forEach(connection => connection.send(data));
      messageRef.current.value = '';
    }
  };

  const handleReady = () => {
    setReady(true);
    const data = { type: 'ready', id: peerId };
    if (isHost.current) broadcastUserList();
    else connections.current.forEach(connection => connection.send(data));
  };

  const handleStartGame = () => {
    if (users.every(user => user.id === peerId || user.ready)) {
      const data = { type: 'start' };
      connections.current.forEach(connection => connection.send(data));
      setGameStarted(true);
    }
  };

  const broadcastUserList = () => {
    const data = { type: 'user-list', users };
    connections.current.forEach(connection => connection.send(data));
  };

  return (
    <div className="chat-room">
      {!gameStarted ? (
        <div className="room-container">
          <div className="user-list">
            <h2>유저 목록</h2>
            <ul>
              {users.map(user => (
                <li key={user.id} className={user.id === peerId ? 'me' : ''}>
                  {user.name} {user.ready && '(준비 완료)'}
                </li>
              ))}
            </ul>
            <div>
              {isHost.current ? (
                <button onClick={handleStartGame} disabled={!users.every(user => user.id === peerId || user.ready)}>게임 시작</button>
              ) : (
                <button onClick={handleReady} disabled={ready}>준비 완료</button>
              )}
            </div>
            <div className="room-info">
              <p>방 코드: {currentRoomId}</p>
            </div>
          </div>
          <div className="message-container">
            <h2>메시지</h2>
            <ul>
              {messages.map((msg, index) => (
                <li key={index} className={msg.from === peerId ? 'me' : ''}>
                  {msg.from === peerId ? `${nickname} (me)` : users.find(user => user.id === msg.from)?.name || 'Unknown'}: {msg.text}
                </li>
              ))}
            </ul>
            <input type="text" placeholder="메시지 입력" ref={messageRef} />
            <button onClick={sendMessage}>보내기</button>
          </div>
        </div>
      ) : (
        <GamePage users={users} />
      )}
    </div>
  );
};


const GamePage = ({ users }) => (
  <div className="game-page">
    <h2>게임중</h2>
    <ul>
      {users.map(user => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  </div>
);

export default App;
