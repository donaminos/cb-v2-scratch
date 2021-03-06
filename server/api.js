Meteor.methods({

  userProfileImage: function(userId) {
    check(userId, String);

    if (userId != '') {
      var user = Meteor.users.findOne({_id: userId});

      return {
        userId : user._id,
        username : user.profile.name,
        avatar : user.user_info.profile.image_192 || user.profile.gravatar
      }
    } else {
      return '';
    }

  },

  getUserDetails : function(userId){
    check(userId, String);
    return Meteor.users.findOne({_id:userId},{fields: { emails: 1, profile: 1, roles: 1, user_info: 1}});
  },

  getUserCount: function() {
    return Meteor.users.find().count();
  },

  getHangoutsJoinedCount: function(userId) {
    check(userId, String);
    return Hangouts.find({users:{$elemMatch:{$eq:userId}},'visibility':{$ne:false}}).count();
  },

  emailHangoutUsers: function(hangoutId) {
    // ssr for email template rendering
    SSR.compileTemplate('notifyEmail', Assets.getText('email-hangout-alerts.html'));

    var tz = "America/Los_Angeles";
    var hangout = Hangouts.findOne(hangoutId);
    var user_id = hangout.user_id;
    var host = Meteor.users.findOne({_id: user_id}).user_info.name;
    var hangout_topic = hangout.topic;
    var hangout_start_time = hangout.start;
    var emails = hangout.email_addresses.join(",");

    var template_data = {
      hangout_topic: hangout_topic,
      host: host,
      hangout_start_time: moment(hangout_start_time).tz(tz).format('MMMM Do YYYY, h:mm a z'),
      logo: Meteor.absoluteUrl('images/cb2-180.png')
    };


    var data = {
      to: emails,
      from: Meteor.settings.email_from,
      html: SSR.render('notifyEmail', template_data),
      subject: 'CodeBuddies Alert: Hangout - ' + hangout_topic + ' has been CANCELLED'
    }
    // let other method calls from same client to star running.
    // without needing to wait to send email
    this.unblock();

    try {
      Email.send(data);
    } catch ( e ) {
      //debug
      console.log("Email.send() error: " + e.message);
      return false;
    }
    return true;
  },

  createHangout: function(data) {
    check(data, Match.ObjectIncluding({
      user_id: String,
      topic: String,
      description: String,
      start: Match.OneOf(String, Date),
      end: Match.OneOf(String, Date),
      type: String,
      username:String,
      email:String
    }));

    var hangout_id = Hangouts.insert({
      user_id: data.user_id,
      creator:data.username,
      topic: data.topic,
      description: data.description,
      start: data.start,
      end: data.end,
      type: data.type,
      users: [ data.user_id ],
      email_addresses: [ data.email ],
      reminder_sent: false,
      timestamp: new Date()
    });
    // create slack message to channel
    var tz = "America/Los_Angeles";
    var host = data.username;
    var hangout_type = data.type;
    var hangout_topic = data.topic;
    var hangout_desc = data.description;
    var hangout_url = Meteor.absoluteUrl('hangout'); // http://<ROOT_URL>/hangout/<hangout_id>
    var start_time = moment(data.start).tz(tz).format('MMMM Do YYYY, h:mm a z');
    var data = {
      attachments: [
        {
          fallback: 'A new hangout has been scheduled. Visit' + Meteor.absoluteUrl() + '',
          color: '#1e90ff',
          pretext: `A new *${hangout_type}* hangout has been scheduled by <@${host}>!`,
          title: `${hangout_topic}`,
          title_link: `${hangout_url}/${hangout_id}`,
          mrkdwn_in: ['text', 'pretext', 'fields'],
          fields: [
            {
              title: 'Description',
              value: `_${hangout_desc}_`,
              short: true
            },
            {
              title: 'Date',
              value: `${start_time}`,
              short: true
            }
            ]
        }
        ]
    }
    // send Slack message to default channel (configured in Meteor settings)
    /* global hangoutAlert from /lib/functions.js */
    hangoutAlert(data);
    return true;
  },

  deleteHangout: function (data) {
    check(data.hangoutId, String);
    check(data.hostId, String);
    check(data.hostUsername, String);

    var response = Meteor.call('emailHangoutUsers', data.hangoutId);
      if (!response) {
          throw new Meteor.Error("Error sending email!");
      } else {
          var actor = Meteor.user()
          if (actor._id === data.hostId) {

            Hangouts.remove({_id: data.hangoutId, user_id: actor._id});
            return true;

          }else{
            Hangouts.update({_id: data.hangoutId},
              {$set:
                {
                 visibility:false
              }
            });

            var notification = {
              actorId : actor._id,
              actorUsername : actor.username || actor.user_info.name,
              subjectId : data.hostId,
              subjectUsername : data.hostUsername,
              hangoutId : data.hangoutId,
              createdAt : new Date(),
              read:[actor._id],
              action : "deleted ",
              icon : "fa-times",
              type : "hangout delete",
            }
            Notifications.insert(notification);
            return true;
          }
      }
  },

  editHangout: function(data) {
    check(data, Match.ObjectIncluding({
      topic: String,
      description: String,
      start: Match.OneOf(String, Date),
      end: Match.OneOf(String, Date),
      type: String,
      //hangoutId, String,
      //hostId, String,
      //hostUsername, String
    }));


    var actor = Meteor.user()
    if (actor._id === data.hostId) {

      Hangouts.update({_id: data.hangoutId, user_id: actor._id},
        {$set:
          {
           topic: data.topic,
           description: data.description,
           start: data.start,
           end: data.end,
           type: data.type
        }
      });
      return true;

    }else{
      Hangouts.update({_id: data.hangoutId},
        {$set:
          {
           topic: data.topic,
           description: data.description,
           start: data.start,
           end: data.end,
           type: data.type
        }
      });

      var notification = {
        actorId : actor._id,
        actorUsername : actor.username || actor.user_info.name,
        subjectId : data.hostId,
        subjectUsername : data.hostUsername,
        hangoutId : data.hangoutId,
        createdAt : new Date(),
        read:[actor._id],
        action : "edited",
        icon : "fa-pencil-square-o",
        type : "hangout edit",
      }
      Notifications.insert(notification);
      return true;
    }


  },
  cloneHangout: function(data, hangoutId) {
    check(data, Match.ObjectIncluding({
      user_id: String,
      topic: String,
      username: String,
      description: String,
      type: String
    }));

    var user = Meteor.users.findOne({_id: data.user_id});
    var user_email = user.user_info.profile.email;
    var hangout_id = Hangouts.insert({
      user_id: data.user_id,
      creator:data.username,
      topic: data.topic,
      creator: user.profile.name,
      description: data.description,
      start: data.start,
      end: data.end,
      type: data.type,
      users: [ data.user_id ],
      email_addresses: [ user_email ],
      reminder_sent: false,
      timestamp: new Date()
    });
     // create slack message to channel
    var tz = "America/Los_Angeles";
    var host = data.username;
    var hangout_type = data.type;
    var hangout_topic = data.topic;
    var hangout_desc = data.description;
    var hangout_url = Meteor.absoluteUrl('hangout'); // http://<ROOT_URL>/hangout/<hangout_id>
    var start_time = moment(data.start).tz(tz).format('MMMM Do YYYY, h:mm a z');
      var data = {
      attachments: [
        {
          fallback: 'A new hangout has been scheduled. Visit' + Meteor.absoluteUrl() + '',
          color: '#1e90ff',
          pretext: `A new *${hangout_type}* hangout has been scheduled by <@${host}>!`,
          title: `${hangout_topic}`,
          title_link: `${hangout_url}/${hangout_id}`,
          mrkdwn_in: ['text', 'pretext', 'fields'],
          fields: [
            {
              title: 'Description',
              value: `_${hangout_desc}_`,
              short: true
            },
            {
              title: 'Date',
              value: `${start_time}`,
              short: true
            }
            ]
        }
        ]
    }
    // send Slack message to default channel (configured in Meteor settings)
    /* global hangoutAlert from /lib/functions.js */
    hangoutAlert(data);
    return true;
  },

  setUserStatus: function(currentStatus) {
    check(currentStatus, String);
    Meteor.users.update({_id: Meteor.userId()}, {$set: {statusMessage: currentStatus, statusDate: new Date()}});
  },

  setHangoutStatus: function(hangoutStatus) {
    check(hangoutStatus, String);
    Meteor.users.update({_id: Meteor.userId()}, {$set: {statusHangout: hangoutStatus}});
  },

  addLearning: function(data) {
    check(data.title, String);
    check(data.user_id, String);
    check(data.username, String);

    Learnings.insert({
      title: data.title,
      userId: data.user_id,
      username: data.username,
      timestamp: new Date(),
      kudos: 0
    });
  },

  deleteLearning: function(learningId) {
    check(learningId, String);
    Learnings.remove( { _id: learningId, userId: this.userId } );
    return true;
  },

  editLearning: function(data) {
    check(data.learningId, String);
    check(data.title, String);
    Learnings.update(
      { _id: data.learningId, userId: this.userId }, {$set: {title: data.title}}
    );
    return true;
  },

  incrementKudoCount: function(learningItemId) {
    Learnings.update(
      { _id: learningItemId },
      {
        $inc: { kudos: 1 },
        $push: { hasLiked: this.userId }
      }
    );
  },

  decrementKudoCount: function(learningItemId) {
    Learnings.update(
      { _id: learningItemId },
      {
        $inc: { kudos: -1 },
        $pull: { hasLiked: this.userId }
      }
    );
    return true;
  },

  getHangout: function(hangoutId) {
    check(hangoutId, String);
    if (Roles.userIsInRole(this.userId, ['admin','moderator'])) {

      return Hangouts.findOne({_id:hangoutId});

    } else {

      return Hangouts.findOne({_id:hangoutId,'visibility': { $ne: false } });

    }

  },

  getHangoutsCount: function() {
    return {hangoutsCount: Hangouts.find({}).count()};
  },

  addUserToHangout: function(hangoutId, createorId, userId) {
    check(hangoutId, String);
    check(createorId, String);
    check(userId, String);
    var user = Meteor.users.findOne({_id: userId});
    var user_email = user.user_info.profile.email;
    Hangouts.update({ _id: hangoutId },
      { $push: { users: userId, email_addresses: user_email }});
      var date = new Date();
    Attendees.upsert({hangoutId : hangoutId, createorId : createorId, seen : false} ,{$set:{date:date}, $inc:{count:1}});
    return true;
  },

  removeUserFromHangout: function(hangoutId, createorId, userId) {
    check(hangoutId, String);
    check(createorId, String);
    check(userId, String);
    Hangouts.update({ _id: hangoutId },
      { $pull: { users: userId } });
      var date = new Date();
    Attendees.update({hangoutId : hangoutId, createorId : createorId, seen : false} ,{$set : {date:date}, $inc:{count:-1} });
    return true;
  },

  reportHangout : function(report){


    check(report.category, String);
    check(report.hangoutId, String);
    check(report.hostId, String);
    check(report.hostUsername, String);
    check(report.reporterId, String);
    var actor = Meteor.user();
    if(report.reporterId !== actor._id){
      throw new Meteor.Error(500, "You are trying do something fishy.")
    }

    var matter = " as " + report.category + ".";
    var notification = {
      actorId : actor._id,
      actorUsername : actor.username || actor.user_info.name,
      subjectId : report.hostId,
      subjectUsername : report.hostUsername,
      hangoutId : report.hangoutId,
      createdAt : new Date(),
      read:[actor._id],
      action : 'reported',
      matter : matter,
      icon : 'fa-exclamation-circle',
      type : 'reported hangout'
    }

    Notifications.insert(notification);
    return true;
  },

  notificationCount : function(){
    return Notifications.find({'read':{$ne:this.userId}}).count();
  },

  incHangoutViewCount : function(hangoutId){
    check(hangoutId, String);
    Hangouts.update({_id:hangoutId}, {$inc:{views:1}});
  },
  markItRead:function(rsvpId){

      Attendees.update({ _id: rsvpId },{$set:{seen:true}});

  },


});
